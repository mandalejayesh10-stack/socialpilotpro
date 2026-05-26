import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Platform } from '@prisma/client';

@Injectable()
export class MetricsComputeService {
  private readonly logger = new Logger(MetricsComputeService.name);

  constructor(private prisma: PrismaService) {}

  // ── Compute post-level metrics ────────────────────────────
  async computePostMetrics(
    integration: any,
    posts: Array<{ id: string; externalId: string | null; publishDate: Date }>,
    rawMetrics: Record<string, any>,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const post of posts) {
      if (!post.externalId) continue;
      const raw = rawMetrics[post.externalId];
      if (!raw) continue;

      const likes = raw.likes || raw.like_count || 0;
      const comments = raw.comments || raw.comment_count || 0;
      const shares = raw.shares || raw.share_count || 0;
      const saves = raw.saved || raw.saves || 0;
      const reach = raw.reach || raw.post_reach || 0;
      const impressions = raw.impressions || raw.post_impressions || 0;
      const videoViews = raw.video_views || raw.post_video_views || raw.plays || raw.views || 0;
      const clicks = raw.post_clicks || raw.clicks || raw.impressions_clicks || 0;

      // Engagement rate = (likes + comments + shares + saves) / reach * 100
      const denominator = reach || impressions || videoViews;
      const engagementRate = denominator > 0
        ? ((likes + comments + shares + saves) / denominator) * 100
        : 0;

      await this.prisma.postMetrics.upsert({
        where: { postId_periodDate: { postId: post.id, periodDate: today } },
        create: {
          organizationId: integration.organizationId,
          integrationId: integration.id,
          postId: post.id,
          platform: integration.platform,
          periodDate: today,
          likes,
          comments,
          shares,
          saves,
          clicks,
          reach,
          impressions,
          videoViews,
          engagementRate: parseFloat(engagementRate.toFixed(4)),
        },
        update: {
          likes,
          comments,
          shares,
          saves,
          clicks,
          reach,
          impressions,
          videoViews,
          engagementRate: parseFloat(engagementRate.toFixed(4)),
          computedAt: new Date(),
        },
      });
    }
  }

  // ── Compute account-level daily metrics ───────────────────
  async computeAccountMetrics(integration: any) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get yesterday's metrics for growth calculation
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const prevMetrics = await this.prisma.accountMetrics.findUnique({
      where: {
        integrationId_periodDate: {
          integrationId: integration.id,
          periodDate: yesterday,
        },
      },
    });

    // Get latest raw data
    const latestRaw = await this.prisma.analyticsRaw.findFirst({
      where: {
        integrationId: integration.id,
        dataType: 'basic_stats',
      },
      orderBy: { fetchedAt: 'desc' },
    });

    if (!latestRaw) return;

    const rawData = JSON.parse(latestRaw.rawData);

    let followers = 0;
    let following = 0;
    let subscribers = 0;
    let totalViews = 0;
    let watchTimeMinutes = 0;

    if (integration.platform === 'INSTAGRAM') {
      followers = rawData.followers_count || 0;
      following = rawData.follows_count || 0;
    } else if (integration.platform === 'FACEBOOK') {
      followers = rawData.fan_count || 0;
    } else if (integration.platform === 'YOUTUBE') {
      subscribers = rawData.subscriberCount || 0;
      totalViews = rawData.viewCount || 0;
      watchTimeMinutes = rawData.watchTimeMinutes || 0;
    }

    const currentFollowers = integration.platform === 'YOUTUBE' ? subscribers : followers;
    const prevFollowers = prevMetrics
      ? (integration.platform === 'YOUTUBE' ? (prevMetrics.subscribers || 0) : prevMetrics.followers)
      : currentFollowers;

    const followersGrowth = currentFollowers - prevFollowers;
    const growthPercent = prevFollowers > 0
      ? parseFloat(((followersGrowth / prevFollowers) * 100).toFixed(4))
      : 0;

    // Aggregate post metrics for today
    const postAgg = await this.prisma.postMetrics.aggregate({
      where: {
        integrationId: integration.id,
        periodDate: today,
      },
      _sum: {
        likes: true,
        comments: true,
        shares: true,
        reach: true,
        impressions: true,
        videoViews: true,
      },
      _avg: {
        engagementRate: true,
      },
      _count: { id: true },
    });

    await this.prisma.accountMetrics.upsert({
      where: {
        integrationId_periodDate: {
          integrationId: integration.id,
          periodDate: today,
        },
      },
      create: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
        platform: integration.platform,
        periodDate: today,
        followers,
        following,
        followersGrowth,
        growthPercent,
        totalPosts: postAgg._count.id,
        totalLikes: postAgg._sum.likes || 0,
        totalComments: postAgg._sum.comments || 0,
        totalShares: postAgg._sum.shares || 0,
        totalReach: postAgg._sum.reach || 0,
        totalImpressions: postAgg._sum.impressions || postAgg._sum.videoViews || 0,
        avgEngagementRate: parseFloat((postAgg._avg.engagementRate || 0).toFixed(4)),
        subscribers: integration.platform === 'YOUTUBE' ? subscribers : null,
        totalViews: integration.platform === 'YOUTUBE' ? totalViews : null,
        watchTimeMinutes: integration.platform === 'YOUTUBE' ? watchTimeMinutes : null,
      },
      update: {
        followers,
        following,
        followersGrowth,
        growthPercent,
        totalPosts: postAgg._count.id,
        totalLikes: postAgg._sum.likes || 0,
        totalComments: postAgg._sum.comments || 0,
        totalShares: postAgg._sum.shares || 0,
        totalReach: postAgg._sum.reach || 0,
        totalImpressions: postAgg._sum.impressions || postAgg._sum.videoViews || 0,
        avgEngagementRate: parseFloat((postAgg._avg.engagementRate || 0).toFixed(4)),
        subscribers: integration.platform === 'YOUTUBE' ? subscribers : null,
        totalViews: integration.platform === 'YOUTUBE' ? totalViews : null,
        watchTimeMinutes: integration.platform === 'YOUTUBE' ? watchTimeMinutes : null,
        computedAt: new Date(),
      },
    });
  }

  // ── Compute analytics summary (pre-aggregated for dashboard) ─
  async computeAnalyticsSummary(
    organizationId: string,
    platform: Platform,
    periodType: string,
  ) {
    const days = periodType === '7d' ? 7 : periodType === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await this.prisma.accountMetrics.findMany({
      where: {
        organizationId,
        platform,
        periodDate: { gte: since },
      },
      orderBy: { periodDate: 'asc' },
    });

    if (metrics.length === 0) return;

    const latest = metrics[metrics.length - 1];
    const earliest = metrics[0];

    const totalFollowers = latest.platform === 'YOUTUBE'
      ? (latest.subscribers || 0)
      : latest.followers;
    const followerGrowth = totalFollowers - (
      latest.platform === 'YOUTUBE' ? (earliest.subscribers || 0) : earliest.followers
    );
    const growthPercent = earliest.followers > 0
      ? parseFloat(((followerGrowth / (latest.platform === 'YOUTUBE' ? (earliest.subscribers || 1) : earliest.followers)) * 100).toFixed(2))
      : 0;

    const avgEngagement = metrics.reduce((sum, m) => sum + m.avgEngagementRate, 0) / metrics.length;
    const totalReach = metrics.reduce((sum, m) => sum + m.totalReach, 0);
    const totalImpressions = metrics.reduce((sum, m) => sum + m.totalImpressions, 0);
    const totalViews = metrics.reduce((sum, m) => sum + (m.totalViews || 0), 0);
    const totalPosts = metrics.reduce((sum, m) => sum + m.totalPosts, 0);

    // Build timeline arrays for charts
    const followerTimeline = metrics.map((m) => ({
      date: m.periodDate.toISOString().split('T')[0],
      value: m.platform === 'YOUTUBE' ? (m.subscribers || 0) : m.followers,
    }));

    const engagementTimeline = metrics.map((m) => ({
      date: m.periodDate.toISOString().split('T')[0],
      value: parseFloat(m.avgEngagementRate.toFixed(2)),
    }));

    const reachTimeline = metrics.map((m) => ({
      date: m.periodDate.toISOString().split('T')[0],
      value: m.platform === 'YOUTUBE' ? (m.totalViews || m.totalReach) : m.totalReach,
    }));

    // Compute best posting time from post metrics
    const postMetrics = await this.prisma.postMetrics.findMany({
      where: {
        organizationId,
        platform,
        periodDate: { gte: since },
      },
      include: { post: { select: { publishDate: true } } },
    });

    const hourEngagement: Record<number, { total: number; count: number }> = {};
    const dayEngagement: Record<number, { total: number; count: number }> = {};

    for (const pm of postMetrics) {
      const hour = pm.post.publishDate.getUTCHours();
      const day = pm.post.publishDate.getUTCDay();

      if (!hourEngagement[hour]) hourEngagement[hour] = { total: 0, count: 0 };
      hourEngagement[hour].total += pm.engagementRate;
      hourEngagement[hour].count++;

      if (!dayEngagement[day]) dayEngagement[day] = { total: 0, count: 0 };
      dayEngagement[day].total += pm.engagementRate;
      dayEngagement[day].count++;
    }

    let bestHour: number | null = null;
    let bestHourAvg = 0;
    for (const [hour, data] of Object.entries(hourEngagement)) {
      const avg = data.total / data.count;
      if (avg > bestHourAvg) {
        bestHourAvg = avg;
        bestHour = parseInt(hour);
      }
    }

    let bestDay: number | null = null;
    let bestDayAvg = 0;
    for (const [day, data] of Object.entries(dayEngagement)) {
      const avg = data.total / data.count;
      if (avg > bestDayAvg) {
        bestDayAvg = avg;
        bestDay = parseInt(day);
      }
    }

    // Determine top content type
    const videoMetrics = postMetrics.filter((pm) => pm.videoViews > 0);
    const topContentType = videoMetrics.length > postMetrics.length / 2 ? 'video' : 'image';

    await this.prisma.analyticsSummary.upsert({
      where: {
        organizationId_platform_periodType: { organizationId, platform, periodType },
      },
      create: {
        organizationId,
        platform,
        periodType,
        totalFollowers,
        followerGrowth,
        growthPercent,
        avgEngagementRate: parseFloat(avgEngagement.toFixed(4)),
        totalPosts,
        totalReach,
        totalImpressions: platform === 'YOUTUBE' ? totalViews : totalImpressions,
        bestPostingHour: bestHour,
        bestPostingDay: bestDay,
        topContentType,
        followerTimeline: JSON.stringify(followerTimeline),
        engagementTimeline: JSON.stringify(engagementTimeline),
        reachTimeline: JSON.stringify(reachTimeline),
      },
      update: {
        totalFollowers,
        followerGrowth,
        growthPercent,
        avgEngagementRate: parseFloat(avgEngagement.toFixed(4)),
        totalPosts,
        totalReach,
        totalImpressions: platform === 'YOUTUBE' ? totalViews : totalImpressions,
        bestPostingHour: bestHour,
        bestPostingDay: bestDay,
        topContentType,
        followerTimeline: JSON.stringify(followerTimeline),
        engagementTimeline: JSON.stringify(engagementTimeline),
        reachTimeline: JSON.stringify(reachTimeline),
        computedAt: new Date(),
      },
    });
  }
}
