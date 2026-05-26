import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Platform } from '@prisma/client';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { MetaOAuthService } from '../integration/providers/meta-oauth.service';
import { YoutubeOAuthService } from '../integration/providers/youtube-oauth.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private prisma: PrismaService,
    private snapshots: AnalyticsSnapshotService,
    private metaOAuth: MetaOAuthService,
    private youtubeOAuth: YoutubeOAuthService,
  ) {}

  // ── Dashboard overview (all platforms) ───────────────────
  async getDashboardOverview(organizationId: string, period: string = '30d') {
    const platforms: Platform[] = ['INSTAGRAM', 'FACEBOOK', 'YOUTUBE'];
    const summaries: Record<string, any> = {};

    for (const platform of platforms) {
      const summary = await this.prisma.analyticsSummary.findUnique({
        where: {
          organizationId_platform_periodType: { organizationId, platform, periodType: period },
        },
      });

      if (summary) summaries[platform.toLowerCase()] = this.serializeSummary(summary);
    }

    return summaries;
  }

  async getSyncStatus(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        platform: true,
        name: true,
        internalId: true,
        pageId: true,
        pageAccessToken: true,
        tokenExpiry: true,
        refreshNeeded: true,
        disabled: true,
        profileData: true,
        updatedAt: true,
      },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });

    const results = await Promise.all(integrations.map(async (integration) => {
      const [latestRaw, latestMetrics, latestSummary] = await Promise.all([
        this.prisma.analyticsRaw.findFirst({
          where: { integrationId: integration.id },
          orderBy: { fetchedAt: 'desc' },
          select: { dataType: true, fetchedAt: true, rawData: true },
        }),
        this.prisma.accountMetrics.findFirst({
          where: { integrationId: integration.id },
          orderBy: { computedAt: 'desc' },
          select: { computedAt: true, periodDate: true },
        }),
        this.prisma.analyticsSummary.findFirst({
          where: { organizationId, platform: integration.platform },
          orderBy: { computedAt: 'desc' },
          select: { computedAt: true, periodType: true },
        }),
      ]);

      const lastSyncedAt =
        latestMetrics?.computedAt || latestSummary?.computedAt || latestRaw?.fetchedAt || null;
      const ageMs = lastSyncedAt ? Date.now() - lastSyncedAt.getTime() : null;
      const stale = ageMs === null || ageMs > 2 * 60 * 60 * 1000;
      const expired = integration.tokenExpiry
        ? integration.tokenExpiry.getTime() < Date.now()
        : false;
      const validation = this.validateIntegration(integration);

      let lastError: string | null = null;
      if (latestRaw?.dataType === 'sync_error') {
        try {
          lastError = JSON.parse(latestRaw.rawData)?.message || null;
        } catch {
          lastError = latestRaw.rawData;
        }
      }

      return {
        integrationId: integration.id,
        platform: integration.platform,
        name: integration.name,
        lastSyncedAt,
        lastRawType: latestRaw?.dataType || null,
        latestMetricAt: latestMetrics?.computedAt || null,
        latestSummaryAt: latestSummary?.computedAt || null,
        status: integration.disabled
          ? 'disabled'
          : integration.refreshNeeded || expired
            ? 'auth_required'
            : lastError
              ? 'failed'
              : stale
                ? 'stale'
                : 'healthy',
        apiHealth: {
          tokenValid: !integration.refreshNeeded && !expired,
          disabled: integration.disabled,
          stale,
          lastError,
        },
        validation,
        quota: {
          protected: true,
          cacheTtlSeconds: 300,
          incrementalSync: true,
        },
      };
    }));

    return {
      generatedAt: new Date(),
      platforms: results,
      schedules: {
        basicStats: process.env.CRON_BASIC_STATS || '*/15 * * * *',
        postMetrics: process.env.CRON_POST_METRICS || '0 * * * *',
        fullAnalytics: process.env.CRON_FULL_ANALYTICS || '0 2 * * *',
      },
    };
  }

  private validateIntegration(integration: any) {
    const checks: Array<{ key: string; label: string; ok: boolean; message?: string }> = [
      {
        key: 'token',
        label: 'OAuth permissions valid',
        ok: !integration.refreshNeeded && !(integration.tokenExpiry && integration.tokenExpiry.getTime() < Date.now()),
        message: 'Reconnect this account to refresh permissions.',
      },
    ];

    let profileData: any = {};
    try {
      profileData = integration.profileData ? JSON.parse(integration.profileData) : {};
    } catch {}

    if (integration.platform === 'FACEBOOK') {
      const permissions = profileData.permissions || [];
      const missing = this.metaOAuth.getMissingInsightPermissions(permissions);
      checks.push({
        key: 'page',
        label: 'Facebook Page connected',
        ok: Boolean(integration.pageId || integration.internalId),
        message: 'Connect a Facebook Page, not only a user profile.',
      });
      checks.push({
        key: 'meta_permissions',
        label: 'Meta insights permissions',
        ok: missing.length === 0,
        message: missing.length ? `Reconnect Meta and grant: ${missing.join(', ')}` : undefined,
      });
    }

    if (integration.platform === 'INSTAGRAM') {
      const accountType = String(profileData.account_type || profileData.accountType || '').toUpperCase();
      const permissions = profileData.permissions || [];
      const missing = this.metaOAuth.getMissingInsightPermissions(permissions);
      checks.push({
        key: 'business_account',
        label: 'Instagram Business/Creator account',
        ok: ['BUSINESS', 'CREATOR'].includes(accountType) || Boolean(integration.internalId),
        message: 'Instagram analytics require a Business or Creator account connected through a Facebook Page.',
      });
      checks.push({
        key: 'meta_permissions',
        label: 'Instagram insights permissions',
        ok: missing.length === 0,
        message: missing.length ? `Reconnect Meta and grant: ${missing.join(', ')}` : undefined,
      });
    }

    if (integration.platform === 'YOUTUBE') {
      const missing = this.youtubeOAuth.getMissingScopes(profileData.grantedScopes || []);
      checks.push({
        key: 'channel',
        label: 'YouTube channel connected',
        ok: Boolean(integration.internalId),
        message: 'Reconnect YouTube and allow YouTube Data + Analytics scopes.',
      });
      checks.push({
        key: 'youtube_scopes',
        label: 'YouTube analytics scopes',
        ok: missing.length === 0,
        message: missing.length ? `Reconnect YouTube and grant: ${missing.join(', ')}` : undefined,
      });
    }

    return {
      ok: checks.every((check) => check.ok),
      checks,
    };
  }

  // ── Platform-specific analytics ───────────────────────────
  async getPlatformAnalytics(
    organizationId: string,
    platform: Platform,
    period: string = '30d',
  ) {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [summary, accountMetrics, topPosts] = await Promise.all([
      this.prisma.analyticsSummary.findUnique({
        where: {
          organizationId_platform_periodType: { organizationId, platform, periodType: period },
        },
      }),
      this.prisma.accountMetrics.findMany({
        where: { organizationId, platform, periodDate: { gte: since } },
        orderBy: { periodDate: 'asc' },
      }),
      this.getTopPosts(organizationId, platform, days),
    ]);

    return {
      summary: summary ? this.serializeSummary(summary) : null,
      accountMetrics,
      topPosts,
      sync: await this.getPlatformSyncStatus(organizationId, platform),
      bestPostingTime: summary
        ? {
            hour: summary.bestPostingHour,
            day: summary.bestPostingDay,
            topContentType: summary.topContentType,
          }
        : null,
    };
  }

  async getDemographics(organizationId: string, platform: Platform, period: string = '30d') {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const since = this.snapshots.startOfDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const rows = await (this.prisma as any).audienceDemographics.findMany({
      where: { organizationId, platform, periodDate: { gte: since } },
      orderBy: { syncedAt: 'desc' },
    });

    const merged = {
      country: {},
      city: {},
      age: {},
      gender: {},
      language: {},
      activeHours: {},
      returningVsNew: {},
    };

    for (const row of rows) {
      this.mergeBreakdown(merged.country, this.snapshots.parseJson(row.country, {}));
      this.mergeBreakdown(merged.city, this.snapshots.parseJson(row.city, {}));
      this.mergeBreakdown(merged.age, this.snapshots.parseJson(row.age, {}));
      this.mergeBreakdown(merged.gender, this.snapshots.parseJson(row.gender, {}));
      this.mergeBreakdown(merged.language, this.snapshots.parseJson(row.language, {}));
      this.mergeBreakdown(merged.activeHours, this.snapshots.parseJson(row.activeHours, {}));
      this.mergeBreakdown(merged.returningVsNew, this.snapshots.parseJson(row.returningVsNew, {}));
    }

    return {
      platform,
      period,
      syncedAt: rows[0]?.syncedAt || null,
      source: rows[0]?.source || null,
      country: this.snapshots.normalizeBreakdown(merged.country),
      city: this.snapshots.normalizeBreakdown(merged.city),
      age: this.snapshots.normalizeBreakdown(merged.age),
      gender: this.snapshots.normalizeBreakdown(merged.gender),
      language: this.snapshots.normalizeBreakdown(merged.language),
      activeHours: this.snapshots.normalizeBreakdown(merged.activeHours),
      returningVsNew: this.snapshots.normalizeBreakdown(merged.returningVsNew),
    };
  }

  private async getPlatformSyncStatus(organizationId: string, platform: Platform) {
    const status = await this.getSyncStatus(organizationId);
    return status.platforms.filter((item) => item.platform === platform);
  }

  // ── Top performing posts ──────────────────────────────────
  async getTopPosts(
    organizationId: string,
    platform: Platform,
    days: number = 30,
    limit: number = 10,
  ) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await this.prisma.postMetrics.findMany({
      where: {
        organizationId,
        platform,
        periodDate: { gte: since },
      },
      include: {
        post: {
          select: {
            id: true,
            content: true,
            mediaUrls: true,
            publishDate: true,
            publishedUrl: true,
          },
        },
      },
      orderBy: { engagementRate: 'desc' },
      take: limit,
    });

    return metrics.map((m) => ({
      postId: m.postId,
      content: m.post.content,
      mediaUrls: JSON.parse(m.post.mediaUrls),
      publishDate: m.post.publishDate,
      publishedUrl: m.post.publishedUrl,
      metrics: {
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        saves: m.saves,
        clicks: m.clicks,
        reach: m.reach,
        impressions: m.impressions,
        views: m.videoViews,
        videoViews: m.videoViews,
        engagementRate: m.engagementRate,
      },
    }));
  }

  // ── Growth chart data ─────────────────────────────────────
  async getGrowthData(
    organizationId: string,
    platform: Platform,
    period: string = '30d',
  ) {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await this.prisma.accountMetrics.findMany({
      where: { organizationId, platform, periodDate: { gte: since } },
      orderBy: { periodDate: 'asc' },
      select: {
        periodDate: true,
        followers: true,
        subscribers: true,
        followersGrowth: true,
        growthPercent: true,
        avgEngagementRate: true,
        totalReach: true,
        totalViews: true,
        totalImpressions: true,
      },
    });

    const byDate = new Map(metrics.map((m) => [m.periodDate.toISOString().split('T')[0], m]));
    let lastFollowers = 0;
    return this.snapshots.dateRange(days).map((date) => {
      const m: any = byDate.get(date);
      const followers = m ? (platform === 'YOUTUBE' ? (m.subscribers || 0) : m.followers) : 0;
      if (followers > 0) lastFollowers = followers;
      return {
        date,
        followers: lastFollowers,
        growth: this.safe(m?.followersGrowth),
        growthPercent: this.safe(m?.growthPercent),
        engagementRate: this.safe(m?.avgEngagementRate),
        reach: this.safe(platform === 'YOUTUBE' ? m?.totalViews : m?.totalReach),
        impressions: this.safe(m?.totalImpressions),
      };
    });
  }

  // ── Content type performance ──────────────────────────────
  async getContentTypePerformance(
    organizationId: string,
    platform: Platform,
    period: string = '30d',
  ) {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await this.prisma.postMetrics.findMany({
      where: {
        organizationId,
        platform,
        periodDate: { gte: since },
      },
      include: {
        post: { select: { mediaUrls: true } },
      },
    });

    const byType: Record<string, { count: number; totalEngagement: number; totalReach: number }> = {
      image: { count: 0, totalEngagement: 0, totalReach: 0 },
      video: { count: 0, totalEngagement: 0, totalReach: 0 },
      text: { count: 0, totalEngagement: 0, totalReach: 0 },
    };

    for (const m of metrics) {
      const mediaUrls = JSON.parse(m.post.mediaUrls || '[]');
      let type = 'text';
      if (mediaUrls.length > 0) {
        type = m.videoViews > 0 ? 'video' : 'image';
      }

      byType[type].count++;
      byType[type].totalEngagement += m.engagementRate;
      byType[type].totalReach += m.reach;
    }

    return Object.entries(byType).map(([type, data]) => ({
      type,
      count: data.count,
      avgEngagementRate: data.count > 0
        ? parseFloat((data.totalEngagement / data.count).toFixed(2))
        : 0,
      totalReach: data.totalReach,
    }));
  }

  // ── Hashtag performance ───────────────────────────────────
  async getHashtagPerformance(organizationId: string, platform: Platform, period: string = '30d') {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const posts = await this.prisma.post.findMany({
      where: {
        organizationId,
        integration: { platform },
        publishDate: { gte: since },
        state: 'PUBLISHED',
        deletedAt: null,
      },
      include: {
        metrics: {
          orderBy: { periodDate: 'desc' },
          take: 1,
        },
      },
    });

    const hashtagStats: Record<string, { count: number; totalEngagement: number }> = {};

    for (const post of posts) {
      if (!post.hashtags) continue;
      const tags = post.hashtags.match(/#\w+/g) || [];
      const engagement = post.metrics[0]?.engagementRate || 0;

      for (const tag of tags) {
        if (!hashtagStats[tag]) hashtagStats[tag] = { count: 0, totalEngagement: 0 };
        hashtagStats[tag].count++;
        hashtagStats[tag].totalEngagement += engagement;
      }
    }

    return Object.entries(hashtagStats)
      .map(([hashtag, data]) => ({
        hashtag,
        count: data.count,
        avgEngagement: parseFloat((data.totalEngagement / data.count).toFixed(2)),
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 20);
  }

  private serializeSummary(summary: any) {
    return {
      ...summary,
      growthPercent: this.safe(summary.growthPercent),
      avgEngagementRate: this.safe(summary.avgEngagementRate),
      followerTimeline: this.cleanTimeline(summary.followerTimeline),
      engagementTimeline: this.cleanTimeline(summary.engagementTimeline),
      reachTimeline: this.cleanTimeline(summary.reachTimeline),
    };
  }

  private cleanTimeline(value: any) {
    const raw = Array.isArray(value) ? value : this.snapshots.parseJson(value, []);
    return raw
      .filter((point: any) => point && point.date)
      .map((point: any) => ({
        date: String(point.date),
        value: this.safe(point.value),
      }));
  }

  private mergeBreakdown(target: Record<string, number>, source: Record<string, any>) {
    for (const [key, value] of Object.entries(source || {})) {
      target[key] = (target[key] || 0) + this.safe(value);
    }
  }

  private safe(value: any) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }
}
