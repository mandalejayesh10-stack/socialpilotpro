import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { safeDecrypt } from '../../common/utils/crypto.util';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';

@Injectable()
export class FacebookAnalyticsService {
  private readonly logger = new Logger(FacebookAnalyticsService.name);
  private readonly version = process.env.META_API_VERSION || 'v21.0';

  constructor(private snapshots: AnalyticsSnapshotService) {}

  async syncDemographics(integration: any) {
    const token = integration.pageAccessToken ? safeDecrypt(integration.pageAccessToken) : safeDecrypt(integration.accessToken);
    const pageId = integration.pageId || integration.internalId;
    if (!pageId) return { skipped: true, reason: 'missing_facebook_page_id' };
    if (!token) {
      this.logger.error(`[syncDemographics] Token decryption failed for integration ${integration.id} — skipping`);
      return { skipped: true, reason: 'token_decryption_failed' };
    }

    const metrics = await this.fetchDemographics(pageId, token);
    await this.snapshots.storeDemographics({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      platform: 'FACEBOOK',
      country: metrics.country,
      city: metrics.city,
      age: metrics.age,
      gender: metrics.gender,
      activeHours: metrics.activeHours,
      source: 'facebook_graph_api',
    });
    return { demographics: true };
  }

  private async fetchDemographics(pageId: string, token: string) {
    const base = `https://graph.facebook.com/${this.version}`;
    const result: Record<string, any> = {};

    try {
      const res = await this.withRetry(() => axios.get(`${base}/${pageId}/insights`, {
        params: {
          access_token: token,
          metric: [
            'page_fans_country',
            'page_fans_city',
            'page_fans_gender_age',
            'page_fans_online',
          ].join(','),
          period: 'lifetime',
        },
      }));

      for (const item of res.data?.data || []) {
        const value = item.values?.[0]?.value || {};
        if (item.name === 'page_fans_country') result.country = value;
        if (item.name === 'page_fans_city') result.city = value;
        if (item.name === 'page_fans_gender_age') this.splitGenderAge(value, result);
        if (item.name === 'page_fans_online') result.activeHours = value;
      }
    } catch (err: any) {
      this.logger.warn(`Facebook demographics unavailable: ${this.errorMessage(err)}`);
    }

    return result;
  }

  private splitGenderAge(values: Record<string, number>, result: Record<string, any>) {
    const age: Record<string, number> = {};
    const gender: Record<string, number> = {};
    for (const [key, value] of Object.entries(values || {})) {
      const [g, a] = key.split('.');
      if (a) age[a] = (age[a] || 0) + Number(value || 0);
      if (g) gender[g] = (gender[g] || 0) + Number(value || 0);
    }
    result.age = age;
    result.gender = gender;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let last: any;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        last = err;
        const status = err?.response?.status;
        if (![429, 500, 502, 503, 504].includes(status) || i === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, i * 900));
      }
    }
    throw last;
  }

  private errorMessage(err: any) {
    return err?.response?.data?.error?.message || err?.message || 'unknown error';
  }
}
