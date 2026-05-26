import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { decrypt } from "../../common/utils/crypto.util";
import { google } from "googleapis";
import axios from "axios";

/**
 * Real-Time Analytics Service
 * Fetches LIVE data directly from YouTube/Meta APIs
 * Used when no cached data exists or when force-refresh is requested
 */
@Injectable()
export class RealTimeAnalyticsService {
  private readonly logger = new Logger(RealTimeAnalyticsService.name);
  private readonly cache = new Map<string, { expiresAt: number; data: any }>();

  constructor(private prisma: PrismaService) {}

  private async getCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    const data = await this.withRetry(fetcher);
    this.cache.set(key, { expiresAt: Date.now() + ttlMs, data });
    return data;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const status = err?.response?.status || err?.code;
        const transient = status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT'].includes(err?.code);
        if (!transient || attempt === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
    throw lastError;
  }

  // ── Force sync all integrations for an org ────────────────
  async forceSyncOrg(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, deletedAt: null, disabled: false },
    });

    const results: any[] = [];
    for (const integration of integrations) {
      try {
        const result = await this.syncIntegration(integration);
        results.push({ integrationId: integration.id, platform: integration.platform, ...result });
      } catch (err) {
        this.logger.error(`Sync failed for ${integration.id}: ${err.message}`);
        results.push({ integrationId: integration.id, platform: integration.platform, error: err.message });
      }
    }
    return results;
  }

  // ── Sync a single integration ─────────────────────────────
  async syncIntegration(integration: any) {
    const token = decrypt(integration.accessToken);
    const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;

    if (integration.platform === "YOUTUBE") {
      return this.syncYouTube(integration, token, refreshToken);
    } else if (integration.platform === "INSTAGRAM") {
      return this.syncInstagram(integration, token);
    } else if (integration.platform === "FACEBOOK") {
      return this.syncFacebook(integration, token);
    }
    return { skipped: true };
  }

  // ── YouTube: fetch real data ──────────────────────────────
  private async syncYouTube(integration: any, token: string, refreshToken: string | null) {
    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({ access_token: token, refresh_token: refreshToken || undefined });

    const youtube = google.youtube({ version: "v3", auth });
    const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });

    // 1. Channel stats
    const channelRes = await youtube.channels.list({
      part: ["statistics", "snippet"],
      mine: true,
    });
    const channel = channelRes.data.items?.[0];
    if (!channel) return { error: "No channel found" };

    const subscribers = parseInt(channel.statistics?.subscriberCount || "0");
    const totalViews = parseInt(channel.statistics?.viewCount || "0");
    const videoCount = parseInt(channel.statistics?.videoCount || "0");

    // 2. YouTube Analytics - daily data for last 30 days
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    let analyticsRows: any[] = [];
    try {
      const analyticsRes = await youtubeAnalytics.reports.query({
        ids: `channel==${integration.internalId}`,
        startDate,
        endDate,
        metrics: "views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost",
        dimensions: "day",
        sort: "day",
      });
      analyticsRows = analyticsRes.data.rows || [];
    } catch (err) {
      this.logger.warn(`YouTube Analytics API: ${err.message}`);
    }

    // 3. Store daily snapshots from analytics data
    for (const row of analyticsRows) {
      const [date, views, watchTime, likes, comments, shares, subsGained, subsLost] = row;
      const periodDate = new Date(date);
      periodDate.setHours(0, 0, 0, 0);

      await this.prisma.accountMetrics.upsert({
        where: { integrationId_periodDate: { integrationId: integration.id, periodDate } },
        create: {
          organizationId: integration.organizationId,
          integrationId: integration.id,
          platform: "YOUTUBE",
          periodDate,
          followers: 0,
          following: 0,
          followersGrowth: (subsGained || 0) - (subsLost || 0),
          growthPercent: 0,
          totalPosts: 0,
          totalLikes: likes || 0,
          totalComments: comments || 0,
          totalShares: shares || 0,
          totalReach: views || 0,
          totalImpressions: views || 0,
          avgEngagementRate: 0,
          subscribers: subscribers,
          totalViews: views || 0,
          watchTimeMinutes: watchTime || 0,
        },
        update: {
          totalLikes: likes || 0,
          totalComments: comments || 0,
          totalShares: shares || 0,
          totalReach: views || 0,
          totalImpressions: views || 0,
          subscribers: subscribers,
          totalViews: views || 0,
          watchTimeMinutes: watchTime || 0,
          followersGrowth: (subsGained || 0) - (subsLost || 0),
          computedAt: new Date(),
        },
      });
    }

    // 4. Store today's snapshot with current subscriber count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.accountMetrics.upsert({
      where: { integrationId_periodDate: { integrationId: integration.id, periodDate: today } },
      create: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
        platform: "YOUTUBE",
        periodDate: today,
        followers: 0,
        following: 0,
        followersGrowth: 0,
        growthPercent: 0,
        totalPosts: videoCount,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalReach: 0,
        totalImpressions: 0,
        avgEngagementRate: 0,
        subscribers: subscribers,
        totalViews: totalViews,
      },
      update: {
        subscribers: subscribers,
        totalViews: totalViews,
        totalPosts: videoCount,
        computedAt: new Date(),
      },
    });

    // 5. Fetch recent videos
    const videosRes = await youtube.search.list({
      part: ["snippet"],
      forMine: true,
      type: ["video"],
      maxResults: 50,
      order: "date",
    });

    const videoIds = (videosRes.data.items || [])
      .map((v: any) => v.id?.videoId)
      .filter(Boolean) as string[];

    let videoDetails: any[] = [];
    if (videoIds.length > 0) {
      const detailsRes = await youtube.videos.list({
        part: ["statistics", "snippet", "contentDetails"],
        id: videoIds,
      });
      videoDetails = detailsRes.data.items || [];
    }

    // 6. Compute and store summary
    await this.computeYouTubeSummary(integration.organizationId, integration.id, subscribers, totalViews, videoCount, analyticsRows);

    return {
      subscribers,
      totalViews,
      videoCount,
      analyticsRows: analyticsRows.length,
      videos: videoDetails.length,
    };
  }

  // ── Instagram: fetch real data ────────────────────────────
  private async syncInstagram(integration: any, token: string) {
    const META_VERSION = process.env.META_API_VERSION || "v21.0";
    const BASE = `https://graph.facebook.com/${META_VERSION}`;
    const accountId = integration.internalId;

    // 1. Account basic stats
    const profileRes = await axios.get(`${BASE}/${accountId}`, {
      params: {
        access_token: token,
        fields: "followers_count,follows_count,media_count,name,username,profile_picture_url,biography,website",
      },
    });
    const profile = profileRes.data;
    const followers = profile.followers_count || 0;

    // 2. Account insights (daily)
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const until = Math.floor(Date.now() / 1000);

    let insightsData: any[] = [];
    try {
      const insightsRes = await axios.get(`${BASE}/${accountId}/insights`, {
        params: {
          access_token: token,
          metric: "impressions,reach,follower_count,profile_views",
          period: "day",
          since,
          until,
        },
      });
      insightsData = insightsRes.data.data || [];
    } catch (err) {
      this.logger.warn(`Instagram insights: ${err.message}`);
    }

    // 3. Build daily data map
    const dailyData: Record<string, any> = {};
    for (const metric of insightsData) {
      for (const val of metric.values || []) {
        const date = val.end_time?.split("T")[0];
        if (!date) continue;
        if (!dailyData[date]) dailyData[date] = {};
        dailyData[date][metric.name] = val.value || 0;
      }
    }

    // 4. Store daily snapshots
    for (const [dateStr, data] of Object.entries(dailyData)) {
      const periodDate = new Date(dateStr);
      periodDate.setHours(0, 0, 0, 0);

      await this.prisma.accountMetrics.upsert({
        where: { integrationId_periodDate: { integrationId: integration.id, periodDate } },
        create: {
          organizationId: integration.organizationId,
          integrationId: integration.id,
          platform: "INSTAGRAM",
          periodDate,
          followers: (data as any).follower_count || followers,
          following: profile.follows_count || 0,
          followersGrowth: 0,
          growthPercent: 0,
          totalPosts: 0,
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalReach: (data as any).reach || 0,
          totalImpressions: (data as any).impressions || 0,
          avgEngagementRate: 0,
        },
        update: {
          followers: (data as any).follower_count || followers,
          totalReach: (data as any).reach || 0,
          totalImpressions: (data as any).impressions || 0,
          computedAt: new Date(),
        },
      });
    }

    // 5. Today's snapshot
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.accountMetrics.upsert({
      where: { integrationId_periodDate: { integrationId: integration.id, periodDate: today } },
      create: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
        platform: "INSTAGRAM",
        periodDate: today,
        followers,
        following: profile.follows_count || 0,
        followersGrowth: 0,
        growthPercent: 0,
        totalPosts: profile.media_count || 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalReach: 0,
        totalImpressions: 0,
        avgEngagementRate: 0,
      },
      update: {
        followers,
        following: profile.follows_count || 0,
        totalPosts: profile.media_count || 0,
        computedAt: new Date(),
      },
    });

    // 6. Compute summary
    await this.computeMetaSummary(integration.organizationId, integration.id, "INSTAGRAM");

    return { followers, mediaCount: profile.media_count, dailySnapshots: Object.keys(dailyData).length };
  }

  // ── Facebook: fetch real data ─────────────────────────────
  private async syncFacebook(integration: any, token: string) {
    const META_VERSION = process.env.META_API_VERSION || "v21.0";
    const BASE = `https://graph.facebook.com/${META_VERSION}`;
    const pageId = integration.pageId || integration.internalId;
    const pageToken = integration.pageAccessToken ? decrypt(integration.pageAccessToken) : token;

    // 1. Page basic stats
    let fanCount = 0;
    try {
      const pageRes = await axios.get(`${BASE}/${pageId}`, {
        params: { access_token: pageToken, fields: "fan_count,name,picture,category,followers_count" },
      });
      fanCount = pageRes.data.fan_count || pageRes.data.followers_count || 0;
    } catch (err) {
      this.logger.warn(`Facebook page stats: ${err.message}`);
    }

    // 2. Page insights
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const until = Math.floor(Date.now() / 1000);

    let insightsData: any[] = [];
    try {
      const insightsRes = await axios.get(`${BASE}/${pageId}/insights`, {
        params: {
          access_token: pageToken,
          metric: "page_impressions,page_reach,page_fans,page_engaged_users",
          period: "day",
          since,
          until,
        },
      });
      insightsData = insightsRes.data.data || [];
    } catch (err) {
      this.logger.warn(`Facebook insights: ${err.message}`);
    }

    // 3. Build daily data map
    const dailyData: Record<string, any> = {};
    for (const metric of insightsData) {
      for (const val of metric.values || []) {
        const date = val.end_time?.split("T")[0];
        if (!date) continue;
        if (!dailyData[date]) dailyData[date] = {};
        dailyData[date][metric.name] = val.value || 0;
      }
    }

    // 4. Store daily snapshots
    for (const [dateStr, data] of Object.entries(dailyData)) {
      const periodDate = new Date(dateStr);
      periodDate.setHours(0, 0, 0, 0);

      await this.prisma.accountMetrics.upsert({
        where: { integrationId_periodDate: { integrationId: integration.id, periodDate } },
        create: {
          organizationId: integration.organizationId,
          integrationId: integration.id,
          platform: "FACEBOOK",
          periodDate,
          followers: (data as any).page_fans || fanCount,
          following: 0,
          followersGrowth: 0,
          growthPercent: 0,
          totalPosts: 0,
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalReach: (data as any).page_reach || 0,
          totalImpressions: (data as any).page_impressions || 0,
          avgEngagementRate: 0,
        },
        update: {
          followers: (data as any).page_fans || fanCount,
          totalReach: (data as any).page_reach || 0,
          totalImpressions: (data as any).page_impressions || 0,
          computedAt: new Date(),
        },
      });
    }

    // 5. Today's snapshot
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.accountMetrics.upsert({
      where: { integrationId_periodDate: { integrationId: integration.id, periodDate: today } },
      create: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
        platform: "FACEBOOK",
        periodDate: today,
        followers: fanCount,
        following: 0,
        followersGrowth: 0,
        growthPercent: 0,
        totalPosts: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalReach: 0,
        totalImpressions: 0,
        avgEngagementRate: 0,
      },
      update: { followers: fanCount, computedAt: new Date() },
    });

    // 6. Compute summary
    await this.computeMetaSummary(integration.organizationId, integration.id, "FACEBOOK");

    return { fanCount, dailySnapshots: Object.keys(dailyData).length };
  }

  // ── Compute YouTube summary ───────────────────────────────
  private async computeYouTubeSummary(
    organizationId: string,
    integrationId: string,
    subscribers: number,
    totalViews: number,
    videoCount: number,
    analyticsRows: any[],
  ) {
    for (const period of ["7d", "30d", "90d"]) {
      const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const metrics = await this.prisma.accountMetrics.findMany({
        where: { integrationId, periodDate: { gte: since } },
        orderBy: { periodDate: "asc" },
      });

      const followerTimeline = metrics.map((m) => ({
        date: m.periodDate.toISOString().split("T")[0],
        value: m.subscribers || subscribers,
      }));

      const reachTimeline = metrics.map((m) => ({
        date: m.periodDate.toISOString().split("T")[0],
        value: m.totalReach || 0,
      }));

      const engagementTimeline = metrics.map((m) => ({
        date: m.periodDate.toISOString().split("T")[0],
        value: parseFloat(m.avgEngagementRate.toFixed(2)),
      }));

      await this.prisma.analyticsSummary.upsert({
        where: { organizationId_platform_periodType: { organizationId, platform: "YOUTUBE", periodType: period } },
        create: {
          organizationId,
          platform: "YOUTUBE",
          periodType: period,
          totalFollowers: subscribers,
          followerGrowth: 0,
          growthPercent: 0,
          avgEngagementRate: 0,
          totalPosts: videoCount,
          totalReach: totalViews,
          totalImpressions: totalViews,
          followerTimeline: JSON.stringify(followerTimeline),
          engagementTimeline: JSON.stringify(engagementTimeline),
          reachTimeline: JSON.stringify(reachTimeline),
        },
        update: {
          totalFollowers: subscribers,
          totalPosts: videoCount,
          totalReach: totalViews,
          totalImpressions: totalViews,
          followerTimeline: JSON.stringify(followerTimeline),
          engagementTimeline: JSON.stringify(engagementTimeline),
          reachTimeline: JSON.stringify(reachTimeline),
          computedAt: new Date(),
        },
      });
    }
  }

  // ── Compute Meta (IG/FB) summary ──────────────────────────
  private async computeMetaSummary(
    organizationId: string,
    integrationId: string,
    platform: "INSTAGRAM" | "FACEBOOK",
  ) {
    for (const period of ["7d", "30d", "90d"]) {
      const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const metrics = await this.prisma.accountMetrics.findMany({
        where: { integrationId, periodDate: { gte: since } },
        orderBy: { periodDate: "asc" },
      });

      if (metrics.length === 0) continue;

      const latest = metrics[metrics.length - 1];
      const earliest = metrics[0];
      const followerGrowth = latest.followers - earliest.followers;
      const growthPercent = earliest.followers > 0
        ? parseFloat(((followerGrowth / earliest.followers) * 100).toFixed(2))
        : 0;

      const totalReach = metrics.reduce((s, m) => s + m.totalReach, 0);
      const totalImpressions = metrics.reduce((s, m) => s + m.totalImpressions, 0);

      const followerTimeline = metrics.map((m) => ({
        date: m.periodDate.toISOString().split("T")[0],
        value: m.followers,
      }));

      const reachTimeline = metrics.map((m) => ({
        date: m.periodDate.toISOString().split("T")[0],
        value: m.totalReach,
      }));

      const engagementTimeline = metrics.map((m) => ({
        date: m.periodDate.toISOString().split("T")[0],
        value: parseFloat(m.avgEngagementRate.toFixed(2)),
      }));

      await this.prisma.analyticsSummary.upsert({
        where: { organizationId_platform_periodType: { organizationId, platform, periodType: period } },
        create: {
          organizationId,
          platform,
          periodType: period,
          totalFollowers: latest.followers,
          followerGrowth,
          growthPercent,
          avgEngagementRate: 0,
          totalPosts: 0,
          totalReach,
          totalImpressions,
          followerTimeline: JSON.stringify(followerTimeline),
          engagementTimeline: JSON.stringify(engagementTimeline),
          reachTimeline: JSON.stringify(reachTimeline),
        },
        update: {
          totalFollowers: latest.followers,
          followerGrowth,
          growthPercent,
          totalReach,
          totalImpressions,
          followerTimeline: JSON.stringify(followerTimeline),
          engagementTimeline: JSON.stringify(engagementTimeline),
          reachTimeline: JSON.stringify(reachTimeline),
          computedAt: new Date(),
        },
      });
    }
  }

  // ── Get YouTube videos with real stats ────────────────────
  async getYouTubeVideos(organizationId: string, params: {
    search?: string; page?: number; limit?: number;
  } = {}) {
    const { search, page = 1, limit = 20 } = params;

    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: "YOUTUBE", deletedAt: null },
    });

    const allVideos: any[] = [];

    for (const integration of integrations) {
      try {
        const token = decrypt(integration.accessToken);
        const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;

        const auth = new google.auth.OAuth2(
          process.env.YOUTUBE_CLIENT_ID,
          process.env.YOUTUBE_CLIENT_SECRET,
        );
        auth.setCredentials({ access_token: token, refresh_token: refreshToken || undefined });

        const youtube = google.youtube({ version: "v3", auth });
        const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });

        const searchRes = await this.getCached(`yt:rt:search:${integration.id}:${search || ''}`, 5 * 60 * 1000, () => youtube.search.list({
          part: ["snippet"],
          forMine: true,
          type: ["video"],
          maxResults: 50,
          order: "date",
          ...(search && { q: search }),
        }));

        const videoIds = (searchRes.data.items || [])
          .map((v: any) => v.id?.videoId)
          .filter(Boolean) as string[];

        if (videoIds.length === 0) continue;

        const detailsRes = await this.getCached(`yt:rt:details:${videoIds.join(',')}`, 5 * 60 * 1000, () => youtube.videos.list({
          part: ["statistics", "snippet", "contentDetails"],
          id: videoIds,
        }));

        const analyticsByVideo: Record<string, any> = {};
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        try {
          const videoAnalytics = await this.getCached(`yt:rt:video-analytics:${videoIds.join(',')}:${startDate}:${endDate}`, 10 * 60 * 1000, () => youtubeAnalytics.reports.query({
            ids: "channel==MINE",
            startDate,
            endDate,
            metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained",
            dimensions: "video",
            filters: `video==${videoIds.join(",")}`,
          }));

          for (const row of videoAnalytics.data.rows || []) {
            const [videoId, views, watchTimeMinutes, averageViewDuration, retentionPercent, likes, comments, shares, subscribersGained] = row;
            analyticsByVideo[videoId] = {
              views: Number(views || 0),
              watchTimeMinutes: Number(watchTimeMinutes || 0),
              averageViewDuration: Number(averageViewDuration || 0),
              retentionPercent: Number(retentionPercent || 0),
              likes: Number(likes || 0),
              comments: Number(comments || 0),
              shares: Number(shares || 0),
              subscribersGained: Number(subscribersGained || 0),
            };
          }
        } catch (err: any) {
          this.logger.warn(`YouTube video analytics for ${integration.id}: ${err.message}`);
        }

        for (const video of detailsRes.data.items || []) {
          const analytics = analyticsByVideo[video.id!] || {};
          const publicViews = parseInt(video.statistics?.viewCount || "0");
          const views = analytics.views || publicViews;
          const likes = analytics.likes || parseInt(video.statistics?.likeCount || "0");
          const comments = analytics.comments || parseInt(video.statistics?.commentCount || "0");
          const engagementRate = views > 0
            ? ((likes + comments + (analytics.shares || 0)) / views) * 100
            : 0;
          allVideos.push({
            id: video.id,
            title: video.snippet?.title,
            thumbnail: video.snippet?.thumbnails?.medium?.url,
            publishedAt: video.snippet?.publishedAt,
            views,
            likes,
            comments,
            shares: analytics.shares || 0,
            watchTimeMinutes: analytics.watchTimeMinutes || 0,
            averageViewDuration: analytics.averageViewDuration || 0,
            retentionPercent: analytics.retentionPercent || 0,
            subscribersGained: analytics.subscribersGained || 0,
            engagementRate: parseFloat(engagementRate.toFixed(2)),
            duration: video.contentDetails?.duration,
            channelName: integration.name,
            integrationId: integration.id,
          });
        }
      } catch (err) {
        this.logger.warn(`YouTube videos for ${integration.id}: ${err.message}`);
      }
    }

    allVideos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const start = (page - 1) * limit;
    return {
      videos: allVideos.slice(start, start + limit),
      total: allVideos.length,
      page,
      pages: Math.ceil(allVideos.length / limit),
    };
  }

  // ── Get YouTube channel stats ─────────────────────────────
  async getYouTubeStats(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: "YOUTUBE", deletedAt: null },
    });

    const stats: any[] = [];
    for (const integration of integrations) {
      try {
        const token = decrypt(integration.accessToken);
        const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;

        const auth = new google.auth.OAuth2(
          process.env.YOUTUBE_CLIENT_ID,
          process.env.YOUTUBE_CLIENT_SECRET,
        );
        auth.setCredentials({ access_token: token, refresh_token: refreshToken || undefined });

        const youtube = google.youtube({ version: "v3", auth });
        const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });

        const channelRes = await youtube.channels.list({
          part: ["statistics", "snippet"],
          mine: true,
        });
        const channel = channelRes.data.items?.[0];

        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        let analyticsData: any = {};
        try {
          const analyticsRes = await this.getCached(`yt:rt:stats:${integration.id}:${startDate}:${endDate}`, 10 * 60 * 1000, () => youtubeAnalytics.reports.query({
            ids: `channel==${integration.internalId}`,
            startDate,
            endDate,
            metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost",
            dimensions: "day",
            sort: "day",
          }));

          const rows = analyticsRes.data.rows || [];
          analyticsData = {
            rows,
            totalViews: rows.reduce((s: number, r: any) => s + (r[1] || 0), 0),
            totalWatchTime: rows.reduce((s: number, r: any) => s + (r[2] || 0), 0),
            avgViewDuration: rows.length ? rows.reduce((s: number, r: any) => s + (r[3] || 0), 0) / rows.length : 0,
            avgRetention: rows.length ? rows.reduce((s: number, r: any) => s + (r[4] || 0), 0) / rows.length : 0,
            totalLikes: rows.reduce((s: number, r: any) => s + (r[5] || 0), 0),
            totalComments: rows.reduce((s: number, r: any) => s + (r[6] || 0), 0),
            totalShares: rows.reduce((s: number, r: any) => s + (r[7] || 0), 0),
            subsGained: rows.reduce((s: number, r: any) => s + (r[8] || 0), 0),
            subsLost: rows.reduce((s: number, r: any) => s + (r[9] || 0), 0),
          };
          try {
            const ctrRes = await this.getCached(`yt:rt:ctr:${integration.id}:${startDate}:${endDate}`, 10 * 60 * 1000, () => youtubeAnalytics.reports.query({
              ids: `channel==${integration.internalId}`,
              startDate,
              endDate,
              metrics: "impressions,impressionClickThroughRate",
              dimensions: "day",
              sort: "day",
            }));
            const ctrRows = ctrRes.data.rows || [];
            analyticsData.ctrRows = ctrRows;
            analyticsData.totalImpressions = ctrRows.reduce((s: number, r: any) => s + (r[1] || 0), 0);
            analyticsData.avgCtr = ctrRows.length ? ctrRows.reduce((s: number, r: any) => s + (r[2] || 0), 0) / ctrRows.length : 0;
          } catch (err: any) {
            this.logger.warn(`YouTube CTR unavailable: ${err.message}`);
          }
        } catch (err) {
          this.logger.warn(`YouTube Analytics: ${err.message}`);
        }

        stats.push({
          integrationId: integration.id,
          channelName: channel?.snippet?.title || integration.name,
          subscribers: parseInt(channel?.statistics?.subscriberCount || "0"),
          totalViews: parseInt(channel?.statistics?.viewCount || "0"),
          videoCount: parseInt(channel?.statistics?.videoCount || "0"),
          ...analyticsData,
        });
      } catch (err) {
        this.logger.warn(`YouTube stats for ${integration.id}: ${err.message}`);
      }
    }

    return stats;
  }

  // ── Instagram: real-time stats ────────────────────────────
  async getInstagramRealtime(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: 'INSTAGRAM', deletedAt: null, disabled: false },
    });

    const results: any[] = [];

    for (const integration of integrations) {
      try {
        const META_VERSION = process.env.META_API_VERSION || 'v21.0';
        const BASE = `https://graph.facebook.com/${META_VERSION}`;
        const token = decrypt(integration.accessToken);
        const accountId = integration.internalId;

        // Profile stats
        const profileRes = await axios.get(`${BASE}/${accountId}`, {
          params: {
            access_token: token,
            fields: 'followers_count,follows_count,media_count,name,username,profile_picture_url,biography,website',
          },
        });
        const profile = profileRes.data;

        // Account insights (last 30 days)
        const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
        const until = Math.floor(Date.now() / 1000);

        let totalReach = 0;
        let totalImpressions = 0;
        let totalProfileViews = 0;
        const dailyData: any[] = [];

        try {
          const insightsRes = await axios.get(`${BASE}/${accountId}/insights`, {
            params: {
              access_token: token,
              metric: 'impressions,reach,follower_count,profile_views',
              period: 'day',
              since,
              until,
            },
          });

          const insightsMap: Record<string, any> = {};
          for (const metric of insightsRes.data.data || []) {
            for (const val of metric.values || []) {
              const date = val.end_time?.split('T')[0];
              if (!date) continue;
              if (!insightsMap[date]) insightsMap[date] = { date };
              insightsMap[date][metric.name] = val.value || 0;
            }
          }

          for (const [date, data] of Object.entries(insightsMap)) {
            const d = data as any;
            totalReach += d.reach || 0;
            totalImpressions += d.impressions || 0;
            totalProfileViews += d.profile_views || 0;
            dailyData.push({
              date,
              reach: d.reach || 0,
              impressions: d.impressions || 0,
              followers: d.follower_count || profile.followers_count,
              profileViews: d.profile_views || 0,
            });
          }
          dailyData.sort((a, b) => a.date.localeCompare(b.date));
        } catch (err) {
          this.logger.warn(`Instagram insights: ${err.message}`);
        }

        results.push({
          integrationId: integration.id,
          accountName: profile.name || integration.name,
          username: profile.username,
          pictureUrl: profile.profile_picture_url || integration.pictureUrl,
          followers: profile.followers_count || 0,
          following: profile.follows_count || 0,
          mediaCount: profile.media_count || 0,
          biography: profile.biography,
          website: profile.website,
          totalReach,
          totalImpressions,
          totalProfileViews,
          dailyData,
        });
      } catch (err) {
        this.logger.warn(`Instagram realtime for ${integration.id}: ${err.message}`);
      }
    }

    return results;
  }

  // ── Instagram: posts with real stats ─────────────────────
  async getInstagramPosts(organizationId: string, params: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = params;
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: 'INSTAGRAM', deletedAt: null },
    });

    const allPosts: any[] = [];

    for (const integration of integrations) {
      try {
        const META_VERSION = process.env.META_API_VERSION || 'v21.0';
        const BASE = `https://graph.facebook.com/${META_VERSION}`;
        const token = decrypt(integration.accessToken);
        const accountId = integration.internalId;

        const mediaRes = await axios.get(`${BASE}/${accountId}/media`, {
          params: {
            access_token: token,
            fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink',
            limit: 50,
          },
        });

        for (const post of mediaRes.data.data || []) {
          // Get insights for each post
          let insights: any = {};
          try {
            const insRes = await axios.get(`${BASE}/${post.id}/insights`, {
              params: {
                access_token: token,
                metric: 'impressions,reach,saved,video_views',
              },
            });
            for (const m of insRes.data.data || []) {
              insights[m.name] = m.values?.[0]?.value || 0;
            }
          } catch {}

          allPosts.push({
            id: post.id,
            caption: post.caption?.slice(0, 200),
            mediaType: post.media_type,
            mediaUrl: post.media_url || post.thumbnail_url,
            timestamp: post.timestamp,
            likes: post.like_count || 0,
            comments: post.comments_count || 0,
            reach: insights.reach || 0,
            impressions: insights.impressions || 0,
            saved: insights.saved || 0,
            videoViews: insights.video_views || 0,
            permalink: post.permalink,
            accountName: integration.name,
          });
        }
      } catch (err) {
        this.logger.warn(`Instagram posts for ${integration.id}: ${err.message}`);
      }
    }

    allPosts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const start = (page - 1) * limit;
    return {
      posts: allPosts.slice(start, start + limit),
      total: allPosts.length,
      page,
      pages: Math.ceil(allPosts.length / limit),
    };
  }

  // ── Facebook: real-time stats ─────────────────────────────
  async getFacebookRealtime(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: 'FACEBOOK', deletedAt: null, disabled: false },
    });

    const results: any[] = [];

    for (const integration of integrations) {
      try {
        const META_VERSION = process.env.META_API_VERSION || 'v21.0';
        const BASE = `https://graph.facebook.com/${META_VERSION}`;
        const token = decrypt(integration.accessToken);
        const pageId = integration.pageId || integration.internalId;
        const pageToken = integration.pageAccessToken ? decrypt(integration.pageAccessToken) : token;

        // Page stats
        let fanCount = 0;
        let pageName = integration.name;
        try {
          const pageRes = await axios.get(`${BASE}/${pageId}`, {
            params: {
              access_token: pageToken,
              fields: 'fan_count,name,picture,category,followers_count,about,website',
            },
          });
          fanCount = pageRes.data.fan_count || pageRes.data.followers_count || 0;
          pageName = pageRes.data.name || integration.name;
        } catch (err) {
          this.logger.warn(`Facebook page stats: ${err.message}`);
        }

        // Page insights (last 30 days)
        const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
        const until = Math.floor(Date.now() / 1000);

        let totalReach = 0;
        let totalImpressions = 0;
        let totalEngaged = 0;
        const dailyData: any[] = [];

        try {
          const insightsRes = await axios.get(`${BASE}/${pageId}/insights`, {
            params: {
              access_token: pageToken,
              metric: 'page_impressions,page_reach,page_fans,page_engaged_users',
              period: 'day',
              since,
              until,
            },
          });

          const insightsMap: Record<string, any> = {};
          for (const metric of insightsRes.data.data || []) {
            for (const val of metric.values || []) {
              const date = val.end_time?.split('T')[0];
              if (!date) continue;
              if (!insightsMap[date]) insightsMap[date] = { date };
              insightsMap[date][metric.name] = val.value || 0;
            }
          }

          for (const [date, data] of Object.entries(insightsMap)) {
            const d = data as any;
            totalReach += d.page_reach || 0;
            totalImpressions += d.page_impressions || 0;
            totalEngaged += d.page_engaged_users || 0;
            dailyData.push({
              date,
              reach: d.page_reach || 0,
              impressions: d.page_impressions || 0,
              fans: d.page_fans || fanCount,
              engaged: d.page_engaged_users || 0,
            });
          }
          dailyData.sort((a, b) => a.date.localeCompare(b.date));
        } catch (err) {
          this.logger.warn(`Facebook insights: ${err.message}`);
        }

        results.push({
          integrationId: integration.id,
          pageName,
          pictureUrl: integration.pictureUrl,
          fanCount,
          totalReach,
          totalImpressions,
          totalEngaged,
          dailyData,
        });
      } catch (err) {
        this.logger.warn(`Facebook realtime for ${integration.id}: ${err.message}`);
      }
    }

    return results;
  }

  // ── Facebook: posts with real stats ──────────────────────
  async getFacebookPosts(organizationId: string, params: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = params;
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: 'FACEBOOK', deletedAt: null },
    });

    const allPosts: any[] = [];

    for (const integration of integrations) {
      try {
        const META_VERSION = process.env.META_API_VERSION || 'v21.0';
        const BASE = `https://graph.facebook.com/${META_VERSION}`;
        const token = decrypt(integration.accessToken);
        const pageId = integration.pageId || integration.internalId;
        const pageToken = integration.pageAccessToken ? decrypt(integration.pageAccessToken) : token;

        const postsRes = await axios.get(`${BASE}/${pageId}/posts`, {
          params: {
            access_token: pageToken,
            fields: 'id,message,story,created_time,full_picture,permalink_url,reactions.summary(true),comments.summary(true),shares',
            limit: 50,
          },
        });

        for (const post of postsRes.data.data || []) {
          // Get post insights
          let insights: any = {};
          try {
            const insRes = await axios.get(`${BASE}/${post.id}/insights`, {
              params: {
                access_token: pageToken,
                metric: 'post_impressions,post_reach,post_clicks,post_engaged_users',
              },
            });
            for (const m of insRes.data.data || []) {
              insights[m.name] = m.values?.[0]?.value || 0;
            }
          } catch {}

          allPosts.push({
            id: post.id,
            message: post.message || post.story || '',
            createdTime: post.created_time,
            picture: post.full_picture,
            permalink: post.permalink_url,
            reactions: post.reactions?.summary?.total_count || 0,
            comments: post.comments?.summary?.total_count || 0,
            shares: post.shares?.count || 0,
            reach: insights.post_reach || 0,
            impressions: insights.post_impressions || 0,
            clicks: insights.post_clicks || 0,
            engaged: insights.post_engaged_users || 0,
            pageName: integration.name,
          });
        }
      } catch (err) {
        this.logger.warn(`Facebook posts for ${integration.id}: ${err.message}`);
      }
    }

    allPosts.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
    const start = (page - 1) * limit;
    return {
      posts: allPosts.slice(start, start + limit),
      total: allPosts.length,
      page,
      pages: Math.ceil(allPosts.length / limit),
    };
  }
}

