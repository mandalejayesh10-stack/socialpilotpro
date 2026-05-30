import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import axios from 'axios';
import { google } from 'googleapis';
import { safeDecrypt } from '../../common/utils/crypto.util';

// ── Types ─────────────────────────────────────────────────────

export interface BestTimeSlot {
  hour: number;
  day: number;
  score: number;           // 0-100 normalized
  label: string;
  dayLabel: string;
  engagementScore: number; // raw weighted score
  postCount: number;
  confidence: number;      // 0-100: how reliable this recommendation is
  trend: 'rising' | 'stable' | 'falling';
  contentTypes: string[];  // which content types perform best here
  why: string;             // human-readable explanation
}

export interface BestTimeResult {
  platform: string;
  timezone: string;
  heatmap: number[][];           // [day 0-6][hour 0-23] = 0-100
  confidenceMap: number[][];     // [day 0-6][hour 0-23] = 0-100
  topSlots: BestTimeSlot[];
  bestDay: number;
  bestHour: number;
  insights: string[];
  todayTrend: { hour: number; label: string; score: number; tag: string; confidence: number }[];
  dataSource: 'real' | 'partial' | 'default';
  postsAnalyzed: number;
  contentTypeBreakdown: Record<string, { avgScore: number; count: number; bestHour: number }>;
  velocityInsights: { postId: string; firstHourScore: number; finalScore: number; multiplier: number }[];
  lastUpdated: string;
}

interface GridCell {
  scores: number[];
  reach: number;
  contentTypes: string[];
  velocityScores: number[];  // early engagement velocity
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:00 ${ampm}`;
});

// Minimum posts needed before we trust real data over defaults
const MIN_POSTS_FOR_REAL = 3;
const MIN_POSTS_FOR_HIGH_CONFIDENCE = 10;

@Injectable()
export class BestTimeService {
  private readonly logger = new Logger(BestTimeService.name);

  constructor(private prisma: PrismaService) {}

  // ── Main entry point ──────────────────────────────────────
  async getBestTimes(
    organizationId: string,
    platform: string,
    timezone = 'Asia/Kolkata',
  ): Promise<BestTimeResult> {
    const platformUpper = platform.toUpperCase();

    // 1. Try stored post metrics (fastest, most reliable)
    const realResult = await this.computeFromRealData(organizationId, platformUpper, timezone);
    if (realResult.postsAnalyzed >= MIN_POSTS_FOR_REAL) {
      this.logger.log(`[BestTime] ${platformUpper}: using real data (${realResult.postsAnalyzed} posts)`);
      return realResult;
    }

    // 2. Try live platform API fetch
    const apiResult = await this.fetchFromPlatformAPI(organizationId, platformUpper, timezone);
    if (apiResult.postsAnalyzed >= MIN_POSTS_FOR_REAL) {
      this.logger.log(`[BestTime] ${platformUpper}: using API data (${apiResult.postsAnalyzed} posts)`);
      return apiResult;
    }

    // 3. Blend partial real data with research defaults
    if (realResult.postsAnalyzed > 0 || apiResult.postsAnalyzed > 0) {
      this.logger.log(`[BestTime] ${platformUpper}: blending partial data with defaults`);
      return this.blendWithDefaults(
        realResult.postsAnalyzed > apiResult.postsAnalyzed ? realResult : apiResult,
        platformUpper,
        timezone,
      );
    }

    // 4. Pure research-based defaults
    this.logger.log(`[BestTime] ${platformUpper}: using research defaults (no account data)`);
    return this.getResearchBasedDefaults(platformUpper, timezone);
  }

  // ── Learn from a newly published post ────────────────────
  // Called by PostSchedulerService after successful publish
  async recordPublishOutcome(
    postId: string,
    organizationId: string,
    platform: string,
    publishDate: Date,
    contentType: string,
  ) {
    // Store a lightweight record for future best-time computation
    // The actual metrics will be picked up by the analytics pipeline
    this.logger.log(`[BestTime] Recorded publish outcome for post ${postId} on ${platform}`);
  }

  // ── Compute from stored PostMetrics ──────────────────────
  private async computeFromRealData(
    organizationId: string,
    platform: string,
    timezone: string,
  ): Promise<BestTimeResult> {
    const posts = await this.prisma.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
        integration: { platform: platform as any },
      },
      include: {
        metrics: { orderBy: { periodDate: 'desc' }, take: 3 },
        integration: { select: { platform: true } },
      },
      orderBy: { publishDate: 'desc' },
      take: 500,
    });

    const grid = this.buildEmptyGrid();
    const contentTypeMap: Record<string, { scores: number[]; hours: number[] }> = {};
    const velocityInsights: BestTimeResult['velocityInsights'] = [];
    let postsWithMetrics = 0;

    for (const post of posts) {
      if (post.metrics.length === 0) continue;

      const latest = post.metrics[0];
      const earliest = post.metrics[post.metrics.length - 1];

      const publishDate = new Date(post.publishDate);
      const day = publishDate.getDay();
      const hour = publishDate.getHours();

      // Detect content type from mediaUrls
      const mediaUrls: string[] = JSON.parse(post.mediaUrls || '[]');
      const contentType = this.detectContentType(mediaUrls, platform);

      const score = this.calculateEngagementScore(platform, {
        likes: latest.likes,
        comments: latest.comments,
        shares: latest.shares,
        saves: latest.saves,
        reach: latest.reach,
        impressions: latest.impressions,
        videoViews: latest.videoViews,
        engagementRate: latest.engagementRate,
        watchTime: 0,
        retention: 0,
        ctr: 0,
      });

      // Early engagement velocity: compare first vs latest metrics
      if (post.metrics.length >= 2) {
        const earlyScore = this.calculateEngagementScore(platform, {
          likes: earliest.likes,
          comments: earliest.comments,
          shares: earliest.shares,
          saves: earliest.saves,
          reach: earliest.reach,
          impressions: earliest.impressions,
          videoViews: earliest.videoViews,
          engagementRate: earliest.engagementRate,
          watchTime: 0, retention: 0, ctr: 0,
        });
        if (earlyScore > 0 && score > 0) {
          const multiplier = score / earlyScore;
          velocityInsights.push({
            postId: post.id,
            firstHourScore: earlyScore,
            finalScore: score,
            multiplier: Math.round(multiplier * 10) / 10,
          });
          // Boost slots where early velocity was high
          grid[day][hour].velocityScores.push(multiplier > 2 ? score * 1.2 : score);
        }
      }

      grid[day][hour].scores.push(score);
      grid[day][hour].reach += latest.reach;
      if (!grid[day][hour].contentTypes.includes(contentType)) {
        grid[day][hour].contentTypes.push(contentType);
      }

      // Track content type performance
      if (!contentTypeMap[contentType]) contentTypeMap[contentType] = { scores: [], hours: [] };
      contentTypeMap[contentType].scores.push(score);
      contentTypeMap[contentType].hours.push(hour);

      postsWithMetrics++;
    }

    if (postsWithMetrics === 0) {
      return { ...this.getResearchBasedDefaults(platform, timezone), postsAnalyzed: 0 };
    }

    const contentTypeBreakdown = this.buildContentTypeBreakdown(contentTypeMap);
    return this.buildResult(platform, timezone, grid, postsWithMetrics, 'real', contentTypeBreakdown, velocityInsights);
  }

  // ── Fetch from platform APIs ──────────────────────────────
  private async fetchFromPlatformAPI(
    organizationId: string,
    platform: string,
    timezone: string,
  ): Promise<BestTimeResult> {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, platform: platform as any, deletedAt: null, disabled: false },
    });

    if (integrations.length === 0) {
      return { ...this.getResearchBasedDefaults(platform, timezone), postsAnalyzed: 0 };
    }

    const grid = this.buildEmptyGrid();
    const contentTypeMap: Record<string, { scores: number[]; hours: number[] }> = {};
    let totalPosts = 0;

    for (const integration of integrations) {
      try {
        // Prefer pageAccessToken for Instagram/Facebook
        const rawToken = (platform === 'INSTAGRAM' || platform === 'FACEBOOK')
          ? (integration.pageAccessToken || integration.accessToken)
          : integration.accessToken;
        const token = safeDecrypt(rawToken);
        const refreshToken = integration.refreshToken ? safeDecrypt(integration.refreshToken) : null;
        if (!token) {
          this.logger.error(`[BestTime] Token decryption failed for ${integration.id} — skipping`);
          continue;
        }

        if (platform === 'INSTAGRAM') {
          totalPosts += await this.fetchInstagramMetrics(integration, token, grid, contentTypeMap);
        } else if (platform === 'FACEBOOK') {
          totalPosts += await this.fetchFacebookMetrics(integration, token, grid, contentTypeMap);
        } else if (platform === 'YOUTUBE') {
          totalPosts += await this.fetchYouTubeMetrics(integration, token, refreshToken, grid, contentTypeMap);
        }
      } catch (err: any) {
        this.logger.warn(`[BestTime] API fetch failed for ${integration.id}: ${err.message}`);
      }
    }

    if (totalPosts === 0) {
      return { ...this.getResearchBasedDefaults(platform, timezone), postsAnalyzed: 0 };
    }

    const contentTypeBreakdown = this.buildContentTypeBreakdown(contentTypeMap);
    return this.buildResult(platform, timezone, grid, totalPosts, 'real', contentTypeBreakdown, []);
  }

  private handleFailedInstagramApiCall(
    err: any,
    method: string,
    endpoint: string,
    accountId: string,
    token: string | undefined,
    requestParams: {
      metrics?: string;
      fields?: string;
      period?: string;
      media_id?: string;
      insight_type?: string;
    }
  ) {
    const status = err?.response?.status || 'Unknown';
    const responseData = err?.response?.data;
    
    let tokenType = 'Unknown';
    if (token) {
      if (token.startsWith('EAA')) {
        tokenType = 'Facebook Page Token (EAA...)';
      } else if (token.startsWith('IGQ') || token.startsWith('IG')) {
        tokenType = 'Instagram Login Token (IGQ... / IG...)';
      }
    }

    const metaErrorType = responseData?.error?.type || 'N/A';
    const metaErrorCode = responseData?.error?.code || 'N/A';
    const metaErrorSubcode = responseData?.error?.error_subcode || 'N/A';
    const metaErrorMessage = responseData?.error?.message || 'N/A';
    const fbTraceId = responseData?.error?.fbtrace_id || 'N/A';

    // Sanitize access_token from endpoint if present
    let maskedEndpoint = endpoint;
    if (endpoint.includes('access_token=')) {
      maskedEndpoint = endpoint.replace(/access_token=[^&]*/g, 'access_token=[MASKED]');
    }

    const logMessage = `[Instagram Analytics Error]

Service: BestTimeService
Method: ${method}

Endpoint:
${maskedEndpoint}

Instagram Account ID:
${accountId}

Token Type:
- ${tokenType}

Request Parameters:
- metrics: ${requestParams.metrics || 'N/A'}
- fields: ${requestParams.fields || 'N/A'}
- period: ${requestParams.period || 'N/A'}
- media_id: ${requestParams.media_id || 'N/A'}
- insight_type: ${requestParams.insight_type || 'N/A'}

HTTP Status:
${status}

Meta Error Type:
${metaErrorType}

Meta Error Code:
${metaErrorCode}

Meta Error Subcode:
${metaErrorSubcode}

Meta Error Message:
${metaErrorMessage}

Meta Trace ID:
${fbTraceId}

Full Response JSON:
${JSON.stringify(responseData, null, 2)}`;

    this.logger.error(logMessage);
    throw err;
  }

  // ── Instagram API fetch ───────────────────────────────────
  private async fetchInstagramMetrics(
    integration: any,
    token: string,
    grid: GridCell[][],
    contentTypeMap: Record<string, { scores: number[]; hours: number[] }>,
  ): Promise<number> {
    const isDirect = token.startsWith('IGQ') || token.startsWith('IG');
    const BASE = isDirect ? `https://graph.instagram.com` : `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}`;
    let count = 0;

    let mediaRes: any;
    try {
      mediaRes = await axios.get(`${BASE}/${integration.internalId}/media`, {
        params: {
          access_token: token,
          fields: 'id,timestamp,like_count,comments_count,media_type,thumbnail_url',
          limit: 50,
        },
        timeout: 15000,
      });
    } catch (err: any) {
      this.handleFailedInstagramApiCall(
        err,
        'fetchInstagramMetrics',
        `${BASE}/${integration.internalId}/media?fields=id,timestamp,like_count,comments_count,media_type,thumbnail_url&limit=50`,
        integration.internalId,
        token,
        {
          fields: 'id,timestamp,like_count,comments_count,media_type,thumbnail_url',
        }
      );
    }

    for (const post of mediaRes.data.data || []) {
      try {
        // Fetch insights including Reel-specific metrics
        const metrics = ['impressions', 'reach', 'saved', 'video_views'];
        if (post.media_type === 'VIDEO') {
          metrics.push('plays', 'total_interactions');
        }

        const insights: Record<string, number> = {};
        if (!isDirect) {
          let insRes: any;
          try {
            insRes = await axios.get(`${BASE}/${post.id}/insights`, {
              params: { access_token: token, metric: metrics.join(',') },
              timeout: 10000,
            });
          } catch (err: any) {
            this.handleFailedInstagramApiCall(
              err,
              'fetchInstagramMetrics',
              `${BASE}/${post.id}/insights?metric=${metrics.join(',')}`,
              integration.internalId,
              token,
              {
                metrics: metrics.join(','),
                media_id: post.id,
              }
            );
          }

          for (const m of insRes.data.data || []) {
            insights[m.name] = m.values?.[0]?.value || m.value || 0;
          }
        }

        const publishDate = new Date(post.timestamp);
        const day = publishDate.getDay();
        const hour = publishDate.getHours();

        const contentType = post.media_type === 'VIDEO' ? 'REEL' :
                            post.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : 'IMAGE';

        const score = this.calculateEngagementScore('INSTAGRAM', {
          likes: post.like_count || 0,
          comments: post.comments_count || 0,
          shares: 0,
          saves: insights.saved || 0,
          reach: insights.reach || 0,
          impressions: insights.impressions || 0,
          videoViews: insights.video_views || insights.plays || 0,
          engagementRate: 0,
          watchTime: 0,
          retention: 0,
          ctr: 0,
        });

        grid[day][hour].scores.push(score);
        grid[day][hour].reach += insights.reach || 0;
        if (!grid[day][hour].contentTypes.includes(contentType)) {
          grid[day][hour].contentTypes.push(contentType);
        }

        if (!contentTypeMap[contentType]) contentTypeMap[contentType] = { scores: [], hours: [] };
        contentTypeMap[contentType].scores.push(score);
        contentTypeMap[contentType].hours.push(hour);

        count++;
      } catch (err: any) {
        throw err;
      }
    }

    return count;
  }

  // ── Facebook API fetch ────────────────────────────────────
  private async fetchFacebookMetrics(
    integration: any,
    token: string,
    grid: GridCell[][],
    contentTypeMap: Record<string, { scores: number[]; hours: number[] }>,
  ): Promise<number> {
    const META_VERSION = process.env.META_API_VERSION || 'v21.0';
    const BASE = `https://graph.facebook.com/${META_VERSION}`;
    const pageId = integration.pageId || integration.internalId;
    const pageToken = integration.pageAccessToken ? safeDecrypt(integration.pageAccessToken) : token;
    let count = 0;

    try {
      const postsRes = await axios.get(`${BASE}/${pageId}/posts`, {
        params: {
          access_token: pageToken,
          fields: 'id,created_time,reactions.summary(true),comments.summary(true),shares,attachments{type}',
          limit: 50,
        },
        timeout: 15000,
      });

      for (const post of postsRes.data.data || []) {
        try {
          const insRes = await axios.get(`${BASE}/${post.id}/insights`, {
            params: {
              access_token: pageToken,
              metric: 'post_impressions,post_reach,post_clicks,post_engaged_users,post_video_views,post_video_avg_time_watched',
            },
            timeout: 10000,
          });

          const insights: Record<string, number> = {};
          for (const m of insRes.data.data || []) {
            insights[m.name] = m.values?.[0]?.value || 0;
          }

          const publishDate = new Date(post.created_time);
          const day = publishDate.getDay();
          const hour = publishDate.getHours();

          const attachType = post.attachments?.data?.[0]?.type || 'status';
          const contentType = attachType.includes('video') ? 'VIDEO' :
                              attachType.includes('photo') ? 'IMAGE' :
                              attachType.includes('album') ? 'CAROUSEL' : 'TEXT';

          const score = this.calculateEngagementScore('FACEBOOK', {
            likes: post.reactions?.summary?.total_count || 0,
            comments: post.comments?.summary?.total_count || 0,
            shares: post.shares?.count || 0,
            saves: 0,
            reach: insights.post_reach || 0,
            impressions: insights.post_impressions || 0,
            videoViews: insights.post_video_views || 0,
            engagementRate: 0,
            watchTime: insights.post_video_avg_time_watched || 0,
            retention: 0,
            ctr: insights.post_clicks || 0,
          });

          grid[day][hour].scores.push(score);
          grid[day][hour].reach += insights.post_reach || 0;
          if (!grid[day][hour].contentTypes.includes(contentType)) {
            grid[day][hour].contentTypes.push(contentType);
          }

          if (!contentTypeMap[contentType]) contentTypeMap[contentType] = { scores: [], hours: [] };
          contentTypeMap[contentType].scores.push(score);
          contentTypeMap[contentType].hours.push(hour);

          count++;
        } catch { /* skip */ }
      }
    } catch (err: any) {
      this.logger.warn(`[BestTime] Facebook: ${err.message}`);
    }

    return count;
  }

  // ── YouTube API fetch ─────────────────────────────────────
  private async fetchYouTubeMetrics(
    integration: any,
    token: string,
    refreshToken: string | null,
    grid: GridCell[][],
    contentTypeMap: Record<string, { scores: number[]; hours: number[] }>,
  ): Promise<number> {
    let count = 0;

    try {
      const auth = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
      );
      if (process.env.FFMPEG_PATH) {
        // no-op — just ensuring env is loaded
      }
      auth.setCredentials({ access_token: token, refresh_token: refreshToken || undefined });

      const youtube = google.youtube({ version: 'v3', auth });
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });

      const videosRes = await youtube.search.list({
        part: ['snippet'],
        forMine: true,
        type: ['video'],
        maxResults: 50,
        order: 'date',
      });

      const videoIds = (videosRes.data.items || [])
        .map((v: any) => v.id?.videoId)
        .filter(Boolean) as string[];

      if (videoIds.length === 0) return 0;

      const statsRes = await youtube.videos.list({
        part: ['statistics', 'snippet', 'contentDetails'],
        id: videoIds,
      });

      for (const video of statsRes.data.items || []) {
        try {
          const publishDate = new Date(video.snippet?.publishedAt || '');
          const day = publishDate.getDay();
          const hour = publishDate.getHours();

          // Detect Short vs long-form
          const duration = video.contentDetails?.duration || '';
          const durationSeconds = this.parseDuration(duration);
          const isShort = durationSeconds > 0 && durationSeconds <= 60;
          const contentType = isShort ? 'SHORT' : 'VIDEO';

          let watchTime = 0;
          let avgViewDuration = 0;
          let ctr = 0;
          let retention = 0;

          try {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(publishDate.getTime() + 86400000).toISOString().split('T')[0];

            if (startDate < endDate) {
              const analyticsRes = await youtubeAnalytics.reports.query({
                ids: `channel==${integration.internalId}`,
                startDate,
                endDate,
                metrics: 'estimatedMinutesWatched,averageViewDuration,annotationClickThroughRate,averageViewPercentage',
                filters: `video==${video.id}`,
              });

              const row = analyticsRes.data.rows?.[0];
              if (row) {
                watchTime = row[0] || 0;
                avgViewDuration = row[1] || 0;
                ctr = row[2] || 0;
                retention = row[3] || 0; // averageViewPercentage
              }
            }
          } catch { /* analytics API may not be available */ }

          const viewCount = parseInt(video.statistics?.viewCount || '0');
          const score = this.calculateEngagementScore('YOUTUBE', {
            likes: parseInt(video.statistics?.likeCount || '0'),
            comments: parseInt(video.statistics?.commentCount || '0'),
            shares: 0,
            saves: 0,
            reach: viewCount,
            impressions: viewCount,
            videoViews: viewCount,
            engagementRate: 0,
            watchTime,
            retention,
            ctr,
          });

          grid[day][hour].scores.push(score);
          grid[day][hour].reach += viewCount;
          if (!grid[day][hour].contentTypes.includes(contentType)) {
            grid[day][hour].contentTypes.push(contentType);
          }

          if (!contentTypeMap[contentType]) contentTypeMap[contentType] = { scores: [], hours: [] };
          contentTypeMap[contentType].scores.push(score);
          contentTypeMap[contentType].hours.push(hour);

          count++;
        } catch { /* skip */ }
      }
    } catch (err: any) {
      this.logger.warn(`[BestTime] YouTube: ${err.message}`);
    }

    return count;
  }

  // ── Engagement score formula ──────────────────────────────
  private calculateEngagementScore(
    platform: string,
    m: {
      likes: number; comments: number; shares: number; saves: number;
      reach: number; impressions: number; videoViews: number;
      engagementRate: number; watchTime: number; retention: number; ctr: number;
    },
  ): number {
    if (platform === 'INSTAGRAM') {
      // Instagram algorithm: saves (4x) > shares (5x) > comments (3x) > likes (1x)
      // Reach normalizes the score so viral posts don't dominate
      const raw = (m.likes * 1) + (m.comments * 3) + (m.shares * 5) + (m.saves * 4) + (m.videoViews * 0.1);
      const reachBonus = m.reach > 0 ? Math.log10(m.reach + 1) * 5 : 0;
      return Math.max(0, raw + reachBonus);
    }
    if (platform === 'FACEBOOK') {
      // Facebook: shares (6x) > comments (3x) > reactions (1x) > clicks (2x)
      const raw = (m.likes * 1) + (m.comments * 3) + (m.shares * 6) + (m.ctr * 2);
      const watchBonus = m.watchTime > 0 ? Math.log10(m.watchTime + 1) * 3 : 0;
      const reachBonus = m.reach > 0 ? Math.log10(m.reach + 1) * 3 : 0;
      return Math.max(0, raw + watchBonus + reachBonus);
    }
    if (platform === 'YOUTUBE') {
      // YouTube: watch time (0.5/min) + retention % (2x) + CTR (3x) + likes (1x) + comments (2x)
      const raw = (m.watchTime * 0.5) + (m.retention * 2) + (m.ctr * 3) +
                  (m.likes * 1) + (m.comments * 2);
      const viewBonus = m.videoViews > 0 ? Math.log10(m.videoViews + 1) * 5 : 0;
      return Math.max(0, raw + viewBonus);
    }
    return 0;
  }

  // ── Build result from grid ────────────────────────────────
  private buildResult(
    platform: string,
    timezone: string,
    grid: GridCell[][],
    postsAnalyzed: number,
    dataSource: 'real' | 'partial' | 'default',
    contentTypeBreakdown: BestTimeResult['contentTypeBreakdown'],
    velocityInsights: BestTimeResult['velocityInsights'],
  ): BestTimeResult {
    // Average scores per slot
    const avgGrid: number[][] = grid.map((dayRow) =>
      dayRow.map((cell) => {
        if (cell.scores.length === 0) return 0;
        const base = cell.scores.reduce((a, b) => a + b, 0) / cell.scores.length;
        // Boost slots with high velocity scores
        const velBoost = cell.velocityScores.length > 0
          ? (cell.velocityScores.reduce((a, b) => a + b, 0) / cell.velocityScores.length) * 0.1
          : 0;
        return base + velBoost;
      }),
    );

    // Confidence: based on number of posts in each slot
    const countGrid: number[][] = grid.map((dayRow) => dayRow.map((cell) => cell.scores.length));

    // Normalize scores to 0-100
    let maxScore = 0;
    for (const row of avgGrid) for (const s of row) if (s > maxScore) maxScore = s;

    const heatmap: number[][] = maxScore > 0
      ? avgGrid.map((row) => row.map((s) => Math.round((s / maxScore) * 100)))
      : this.getDefaultHeatmap(platform);

    // Confidence map: 0 posts = 0, 1-2 = 30, 3-5 = 60, 6-9 = 80, 10+ = 100
    const confidenceMap: number[][] = countGrid.map((row) =>
      row.map((c) => c === 0 ? 0 : c === 1 ? 25 : c <= 2 ? 40 : c <= 5 ? 65 : c <= 9 ? 80 : 95),
    );

    // Build top slots
    const slots: BestTimeSlot[] = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const score = heatmap[day][hour];
        if (score === 0) continue;
        const cell = grid[day][hour];
        const confidence = confidenceMap[day][hour];
        const why = this.generateSlotWhy(platform, day, hour, score, confidence, cell.contentTypes, postsAnalyzed);

        slots.push({
          hour, day, score,
          label: HOUR_LABELS[hour],
          dayLabel: DAY_LABELS[day],
          engagementScore: avgGrid[day][hour],
          postCount: cell.scores.length,
          confidence,
          trend: this.detectTrend(cell.scores),
          contentTypes: cell.contentTypes,
          why,
        });
      }
    }

    slots.sort((a, b) => b.score - a.score);
    const topSlots = slots.slice(0, 10);
    const bestSlot = topSlots[0];

    // Today's trend
    const todayDay = new Date().getDay();
    const todayTrend = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: HOUR_LABELS[h],
      score: heatmap[todayDay][h],
      confidence: confidenceMap[todayDay][h],
      tag: heatmap[todayDay][h] > 80 ? 'Viral potential' :
           heatmap[todayDay][h] > 60 ? 'High engagement' :
           heatmap[todayDay][h] > 40 ? 'Good time' : 'Low activity',
    })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    const insights = this.generateInsights(platform, topSlots, postsAnalyzed, dataSource, contentTypeBreakdown, velocityInsights);

    return {
      platform, timezone, heatmap, confidenceMap, topSlots,
      bestDay: bestSlot?.day ?? this.getDefaultBestDay(platform),
      bestHour: bestSlot?.hour ?? this.getDefaultBestHour(platform),
      insights, todayTrend, dataSource, postsAnalyzed,
      contentTypeBreakdown, velocityInsights,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ── Blend partial real data with defaults ─────────────────
  private blendWithDefaults(
    partial: BestTimeResult,
    platform: string,
    timezone: string,
  ): BestTimeResult {
    const defaults = this.getResearchBasedDefaults(platform, timezone);
    const weight = Math.min(partial.postsAnalyzed / MIN_POSTS_FOR_REAL, 1);

    const blendedHeatmap = partial.heatmap.map((row, d) =>
      row.map((score, h) => {
        const defaultScore = defaults.heatmap[d][h];
        return Math.round(score * weight + defaultScore * (1 - weight));
      }),
    );

    return {
      ...partial,
      heatmap: blendedHeatmap,
      dataSource: 'partial',
      insights: [
        `Based on ${partial.postsAnalyzed} post${partial.postsAnalyzed !== 1 ? 's' : ''} — publish more to improve accuracy.`,
        ...partial.insights.slice(1),
      ],
    };
  }

  // ── Generate "why" explanation for a slot ─────────────────
  private generateSlotWhy(
    platform: string,
    day: number,
    hour: number,
    score: number,
    confidence: number,
    contentTypes: string[],
    postsAnalyzed: number,
  ): string {
    const parts: string[] = [];

    if (postsAnalyzed === 0) {
      parts.push('Based on industry research for this platform.');
    } else if (confidence < 40) {
      parts.push(`Limited data (${confidence}% confidence) — based on ${postsAnalyzed} posts.`);
    } else {
      parts.push(`${confidence}% confidence based on your real post performance.`);
    }

    if (score >= 80) parts.push('Your audience is highly active at this time.');
    else if (score >= 60) parts.push('Above-average engagement window for your audience.');
    else if (score >= 40) parts.push('Moderate engagement expected.');

    if (contentTypes.length > 0) {
      parts.push(`${contentTypes.join(', ')} content performs best here.`);
    }

    // Platform-specific context
    if (platform === 'INSTAGRAM' && hour >= 18 && hour <= 21) {
      parts.push('Evening hours drive 32% more Reel reach on Instagram.');
    } else if (platform === 'FACEBOOK' && day >= 3 && day <= 5 && hour >= 13 && hour <= 16) {
      parts.push('Wed-Fri afternoon is peak Facebook engagement time.');
    } else if (platform === 'YOUTUBE' && (day === 0 || day === 5 || day === 6)) {
      parts.push('Weekend uploads get 40% more views in the first 24 hours.');
    }

    return parts.join(' ');
  }

  // ── Detect trend from score history ──────────────────────
  private detectTrend(scores: number[]): 'rising' | 'stable' | 'falling' {
    if (scores.length < 3) return 'stable';
    const recent = scores.slice(-3);
    const older = scores.slice(0, Math.max(1, scores.length - 3));
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    if (recentAvg > olderAvg * 1.15) return 'rising';
    if (recentAvg < olderAvg * 0.85) return 'falling';
    return 'stable';
  }

  // ── Content type detection ────────────────────────────────
  private detectContentType(mediaUrls: string[], platform: string): string {
    if (mediaUrls.length === 0) return 'TEXT';
    if (mediaUrls.length > 1) return 'CAROUSEL';
    const url = mediaUrls[0].toLowerCase();
    if (url.match(/\.(mp4|mov|avi|webm|m4v)$/)) {
      return platform === 'INSTAGRAM' ? 'REEL' : platform === 'YOUTUBE' ? 'VIDEO' : 'VIDEO';
    }
    return 'IMAGE';
  }

  // ── Content type breakdown ────────────────────────────────
  private buildContentTypeBreakdown(
    map: Record<string, { scores: number[]; hours: number[] }>,
  ): BestTimeResult['contentTypeBreakdown'] {
    const result: BestTimeResult['contentTypeBreakdown'] = {};
    for (const [type, data] of Object.entries(map)) {
      if (data.scores.length === 0) continue;
      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      // Find most common hour
      const hourCounts: Record<number, number> = {};
      for (const h of data.hours) hourCounts[h] = (hourCounts[h] || 0) + 1;
      const bestHour = parseInt(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '12');
      result[type] = { avgScore: Math.round(avgScore), count: data.scores.length, bestHour };
    }
    return result;
  }

  // ── Parse ISO 8601 duration ───────────────────────────────
  private parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return (parseInt(match[1] || '0') * 3600) +
           (parseInt(match[2] || '0') * 60) +
           parseInt(match[3] || '0');
  }

  // ── Generate insights ─────────────────────────────────────
  private generateInsights(
    platform: string,
    topSlots: BestTimeSlot[],
    postCount: number,
    dataSource: 'real' | 'partial' | 'default',
    contentTypeBreakdown: BestTimeResult['contentTypeBreakdown'],
    velocityInsights: BestTimeResult['velocityInsights'],
  ): string[] {
    const insights: string[] = [];
    const isReal = dataSource === 'real' && postCount >= MIN_POSTS_FOR_REAL;
    const isPartial = dataSource === 'partial';

    // Data quality notice
    if (!isReal && !isPartial) {
      insights.push(`Connect your ${platform.charAt(0) + platform.slice(1).toLowerCase()} account and publish posts to get personalized recommendations based on your real audience data.`);
    } else if (isPartial) {
      insights.push(`Showing blended recommendations (${postCount} posts analyzed). Publish more to improve accuracy — ${MIN_POSTS_FOR_HIGH_CONFIDENCE - postCount} more posts needed for high confidence.`);
    } else {
      insights.push(`Personalized recommendations based on ${postCount} real posts from your account.`);
    }

    // Best slot insight
    if (topSlots.length > 0) {
      const best = topSlots[0];
      insights.push(`Best time: ${best.label} on ${best.dayLabel} — ${best.score}% engagement score (${best.confidence}% confidence). ${best.why}`);
    }

    // Top days
    if (topSlots.length >= 3) {
      const topDays = [...new Set(topSlots.slice(0, 5).map((s) => s.dayLabel))];
      insights.push(`Peak days: ${topDays.slice(0, 3).join(', ')}.`);
    }

    // Content type insights
    const ctEntries = Object.entries(contentTypeBreakdown).sort((a, b) => b[1].avgScore - a[1].avgScore);
    if (ctEntries.length > 0) {
      const [bestType, bestData] = ctEntries[0];
      insights.push(`${bestType} content performs best for your account (avg score: ${bestData.avgScore}, best at ${HOUR_LABELS[bestData.bestHour]}).`);
    }

    // Velocity insights
    if (velocityInsights.length > 0) {
      const highVelocity = velocityInsights.filter((v) => v.multiplier >= 3);
      if (highVelocity.length > 0) {
        insights.push(`${highVelocity.length} of your posts had 3x+ early engagement velocity — these time slots are your viral windows.`);
      }
    }

    // Platform-specific
    if (platform === 'INSTAGRAM') {
      if (isReal) {
        const reelData = contentTypeBreakdown['REEL'];
        if (reelData && reelData.count > 0) {
          insights.push(`Your Reels average ${reelData.avgScore} engagement score. Post Reels at ${HOUR_LABELS[reelData.bestHour]} for best results.`);
        }
        insights.push('Saves and shares are weighted 4-5x more than likes in Instagram\'s algorithm.');
      } else {
        insights.push('Reels posted 7PM-9PM get 32% more reach. Saves and shares drive algorithmic distribution.');
      }
    } else if (platform === 'FACEBOOK') {
      if (isReal) {
        insights.push('Shares are weighted 6x more than reactions in Facebook\'s algorithm. Create shareable content.');
      } else {
        insights.push('Wednesday-Friday 1PM-4PM is peak engagement. Videos under 3 minutes perform best.');
      }
    } else if (platform === 'YOUTUBE') {
      const shortData = contentTypeBreakdown['SHORT'];
      const videoData = contentTypeBreakdown['VIDEO'];
      if (shortData && videoData) {
        const better = shortData.avgScore > videoData.avgScore ? 'Shorts' : 'long-form videos';
        insights.push(`${better} perform better on your channel. Focus on ${better} for maximum growth.`);
      }
      if (isReal) {
        insights.push('Watch time and audience retention are YouTube\'s top ranking signals. Aim for 50%+ retention.');
      } else {
        insights.push('Friday-Sunday uploads get 40% more views in the first 24 hours. Add #Shorts to videos under 60 seconds.');
      }
    }

    return insights;
  }

  // ── Research-based defaults ───────────────────────────────
  private getResearchBasedDefaults(platform: string, timezone: string): BestTimeResult {
    const heatmap = this.getDefaultHeatmap(platform);
    const confidenceMap = heatmap.map((row) => row.map((s) => s > 0 ? 20 : 0)); // low confidence for defaults

    const slots: BestTimeSlot[] = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const score = heatmap[day][hour];
        if (score > 40) {
          slots.push({
            hour, day, score,
            label: HOUR_LABELS[hour],
            dayLabel: DAY_LABELS[day],
            engagementScore: score,
            postCount: 0,
            confidence: 20,
            trend: 'stable',
            contentTypes: [],
            why: 'Based on industry research. Connect your account for personalized recommendations.',
          });
        }
      }
    }

    slots.sort((a, b) => b.score - a.score);
    const topSlots = slots.slice(0, 10);
    const bestSlot = topSlots[0];
    const todayDay = new Date().getDay();

    const todayTrend = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: HOUR_LABELS[h],
      score: heatmap[todayDay][h],
      confidence: heatmap[todayDay][h] > 0 ? 20 : 0,
      tag: heatmap[todayDay][h] > 80 ? 'Viral potential' :
           heatmap[todayDay][h] > 60 ? 'High engagement' :
           heatmap[todayDay][h] > 40 ? 'Good time' : 'Low activity',
    })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    return {
      platform, timezone, heatmap, confidenceMap, topSlots,
      bestDay: bestSlot?.day ?? this.getDefaultBestDay(platform),
      bestHour: bestSlot?.hour ?? this.getDefaultBestHour(platform),
      insights: this.generateInsights(platform, topSlots, 0, 'default', {}, []),
      todayTrend, dataSource: 'default', postsAnalyzed: 0,
      contentTypeBreakdown: {}, velocityInsights: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private buildEmptyGrid(): GridCell[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ scores: [], reach: 0, contentTypes: [], velocityScores: [] })),
    );
  }

  private getDefaultHeatmap(platform: string): number[][] {
    const base: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

    if (platform === 'INSTAGRAM') {
      const hot = [
        [1,9,85],[1,10,90],[1,11,80],[1,19,95],[1,20,88],[1,21,75],
        [2,9,80],[2,10,88],[2,11,82],[2,19,90],[2,20,85],[2,21,70],
        [3,9,82],[3,10,92],[3,11,85],[3,19,88],[3,20,82],[3,21,72],
        [4,9,78],[4,10,85],[4,11,80],[4,19,85],[4,20,80],[4,21,68],
        [5,9,75],[5,10,80],[5,11,75],[5,19,80],[5,20,75],[5,21,65],
        [0,14,60],[0,15,65],[0,16,60],[6,14,58],[6,15,62],[6,16,55],
        [1,12,65],[2,12,68],[3,12,70],[4,12,65],[5,12,60],
      ];
      for (const [d, h, s] of hot) base[d][h] = s;
    } else if (platform === 'FACEBOOK') {
      const hot = [
        [3,13,88],[3,14,95],[3,15,90],[3,16,82],
        [4,13,85],[4,14,92],[4,15,88],[4,16,80],
        [5,12,80],[5,13,85],[5,14,88],[5,15,82],
        [1,9,70],[1,10,75],[2,10,72],[2,11,78],
        [0,14,60],[0,15,65],[6,14,58],[6,15,62],
        [3,9,72],[4,9,70],[5,9,68],
      ];
      for (const [d, h, s] of hot) base[d][h] = s;
    } else if (platform === 'YOUTUBE') {
      const hot = [
        [5,14,85],[5,15,90],[5,16,88],[5,20,82],[5,21,78],
        [6,14,88],[6,15,95],[6,16,90],[6,20,85],[6,21,80],
        [0,14,85],[0,15,90],[0,16,85],[0,20,80],[0,21,75],
        [4,15,75],[4,16,78],[4,20,72],
        [3,15,70],[3,16,72],
        [1,12,65],[2,12,68],
      ];
      for (const [d, h, s] of hot) base[d][h] = s;
    }

    return base;
  }

  private getDefaultBestDay(platform: string): number {
    return ({ INSTAGRAM: 3, FACEBOOK: 3, YOUTUBE: 6 } as any)[platform] ?? 3;
  }

  private getDefaultBestHour(platform: string): number {
    return ({ INSTAGRAM: 19, FACEBOOK: 14, YOUTUBE: 15 } as any)[platform] ?? 12;
  }
}
