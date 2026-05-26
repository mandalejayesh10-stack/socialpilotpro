import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { decrypt } from '../../common/utils/crypto.util';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';

@Injectable()
export class YouTubeAnalyticsService {
  private readonly logger = new Logger(YouTubeAnalyticsService.name);

  constructor(private snapshots: AnalyticsSnapshotService) {}

  async syncDemographics(integration: any) {
    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({
      access_token: decrypt(integration.accessToken),
      refresh_token: integration.refreshToken ? decrypt(integration.refreshToken) : undefined,
    });

    const analytics = google.youtubeAnalytics({ version: 'v2', auth });
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ids = `channel==${integration.internalId}`;

    const demographics: Record<string, any> = {};
    try {
      demographics.age = await this.queryBreakdown(analytics, ids, startDate, endDate, 'ageGroup');
      demographics.gender = await this.queryBreakdown(analytics, ids, startDate, endDate, 'gender');
      demographics.country = await this.queryBreakdown(analytics, ids, startDate, endDate, 'country');
    } catch (err: any) {
      this.logger.warn(`YouTube demographics unavailable: ${err?.message || 'unknown error'}`);
    }

    await this.snapshots.storeDemographics({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      platform: 'YOUTUBE',
      country: demographics.country,
      age: demographics.age,
      gender: demographics.gender,
      source: 'youtube_analytics_api',
    });

    return { demographics: true };
  }

  private async queryBreakdown(analytics: any, ids: string, startDate: string, endDate: string, dimension: string) {
    const res: any = await this.withRetry(() => analytics.reports.query({
      ids,
      startDate,
      endDate,
      dimensions: dimension,
      metrics: 'viewerPercentage',
      sort: dimension,
    }));
    const output: Record<string, number> = {};
    for (const row of res.data.rows || []) {
      output[String(row[0] || 'Unknown')] = Number(row[1] || 0);
    }
    return output;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let last: any;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        last = err;
        const status = err?.response?.status || err?.code;
        if (![429, 500, 502, 503, 504].includes(Number(status)) || i === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, i * 900));
      }
    }
    throw last;
  }
}
