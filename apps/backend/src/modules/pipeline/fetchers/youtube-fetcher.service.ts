import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';

@Injectable()
export class YoutubeFetcherService {
  private readonly logger = new Logger(YoutubeFetcherService.name);
  private readonly cache = new Map<string, { expiresAt: number; data: any }>();

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
        const status = err?.code || err?.response?.status;
        const transient = status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT'].includes(err?.code);
        if (!transient || attempt === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
    throw lastError;
  }

  private createAuth(accessToken: string, refreshToken?: string | null) {
    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
    });
    return auth;
  }

  // ── Channel basic stats ───────────────────────────────────
  async fetchChannelStats(channelId: string, accessToken: string, refreshToken?: string | null) {
    const auth = this.createAuth(accessToken, refreshToken);
    const youtube = google.youtube({ version: 'v3', auth });

    const res = await this.getCached(`yt:channel:${channelId}`, 5 * 60 * 1000, () => youtube.channels.list({
      part: ['statistics', 'snippet'],
      id: [channelId],
    }));

    const channel = res.data.items?.[0];
    if (!channel) return {};

    return {
      subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
      viewCount: parseInt(channel.statistics?.viewCount || '0'),
      videoCount: parseInt(channel.statistics?.videoCount || '0'),
      title: channel.snippet?.title,
      thumbnailUrl: channel.snippet?.thumbnails?.default?.url,
    };
  }

  // ── Video metrics ─────────────────────────────────────────
  async fetchVideoMetrics(
    videoIds: string[],
    accessToken: string,
    refreshToken?: string | null,
  ) {
    if (videoIds.length === 0) return {};

    const auth = this.createAuth(accessToken, refreshToken);
    const youtube = google.youtube({ version: 'v3', auth });

    const results: Record<string, any> = {};

    // Batch in groups of 50
    const batches = this.chunk(videoIds, 50);
    for (const batch of batches) {
      const res = await this.getCached(`yt:videos:${batch.join(',')}`, 10 * 60 * 1000, () => youtube.videos.list({
        part: ['statistics', 'snippet', 'contentDetails'],
        id: batch,
      }));

      for (const video of res.data.items || []) {
        const seconds = this.parseIsoDuration(video.contentDetails?.duration || '');
        const isShort = seconds > 0 && seconds <= 60;
        results[video.id!] = {
          views: parseInt(video.statistics?.viewCount || '0'),
          likes: parseInt(video.statistics?.likeCount || '0'),
          comments: parseInt(video.statistics?.commentCount || '0'),
          favorites: parseInt(video.statistics?.favoriteCount || '0'),
          title: video.snippet?.title,
          publishedAt: video.snippet?.publishedAt,
          durationSeconds: seconds,
          isShort,
        };
      }
    }

    await this.mergeVideoAnalytics(results, accessToken, refreshToken);

    return results;
  }

  // ── YouTube Analytics (requires yt-analytics scope) ──────
  async fetchAnalytics(
    channelId: string,
    accessToken: string,
    refreshToken?: string | null,
  ) {
    const auth = this.createAuth(accessToken, refreshToken);
    const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    try {
      const baseMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost';
      const res = await this.getCached(`yt:analytics:${channelId}:${startDate}:${endDate}`, 10 * 60 * 1000, () => youtubeAnalytics.reports.query({
        ids: `channel==${channelId}`,
        startDate,
        endDate,
        metrics: baseMetrics,
        dimensions: 'day',
        sort: 'day',
      }));

      let ctrRows: any[] = [];
      try {
        const ctrRes = await this.getCached(`yt:ctr:${channelId}:${startDate}:${endDate}`, 10 * 60 * 1000, () => youtubeAnalytics.reports.query({
          ids: `channel==${channelId}`,
          startDate,
          endDate,
          metrics: 'impressions,impressionClickThroughRate',
          dimensions: 'day',
          sort: 'day',
        }));
        ctrRows = ctrRes.data.rows || [];
      } catch (err: any) {
        this.logger.warn(`YouTube CTR metrics unavailable: ${err.message}`);
      }

      return {
        rows: res.data.rows || [],
        ctrRows,
        columnHeaders: res.data.columnHeaders || [],
      };
    } catch (err) {
      this.logger.warn(`YouTube Analytics API failed: ${err.message}`);
      return { rows: [], columnHeaders: [] };
    }
  }

  private async mergeVideoAnalytics(
    results: Record<string, any>,
    accessToken: string,
    refreshToken?: string | null,
  ) {
    const videoIds = Object.keys(results);
    if (videoIds.length === 0) return;

    const auth = this.createAuth(accessToken, refreshToken);
    const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const batch of this.chunk(videoIds, 200)) {
      try {
        const res = await this.getCached(`yt:video-analytics:${batch.join(',')}:${startDate}:${endDate}`, 10 * 60 * 1000, () => youtubeAnalytics.reports.query({
          ids: 'channel==MINE',
          startDate,
          endDate,
          metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained',
          dimensions: 'video',
          filters: `video==${batch.join(',')}`,
        }));

        for (const row of res.data.rows || []) {
          const [
            videoId,
            views,
            watchTimeMinutes,
            averageViewDuration,
            retentionPercent,
            likes,
            comments,
            shares,
            subscribersGained,
          ] = row;
          results[videoId] = {
            ...results[videoId],
            views: Number(views || results[videoId]?.views || 0),
            watchTimeMinutes: Number(watchTimeMinutes || 0),
            averageViewDuration: Number(averageViewDuration || 0),
            retentionPercent: Number(retentionPercent || 0),
            likes: Number(likes || results[videoId]?.likes || 0),
            comments: Number(comments || results[videoId]?.comments || 0),
            shares: Number(shares || 0),
            subscribersGained: Number(subscribersGained || 0),
          };
        }
      } catch (err: any) {
        this.logger.warn(`YouTube video analytics unavailable: ${err.message}`);
      }
    }
  }

  private parseIsoDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
