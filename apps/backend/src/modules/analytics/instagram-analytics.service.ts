import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { decrypt } from '../../common/utils/crypto.util';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';

@Injectable()
export class InstagramAnalyticsService {
  private readonly logger = new Logger(InstagramAnalyticsService.name);
  private readonly version = process.env.META_API_VERSION || 'v21.0';

  constructor(private snapshots: AnalyticsSnapshotService) {}

  async syncDemographics(integration: any) {
    const token = decrypt(integration.accessToken);
    const accountId = integration.internalId;
    if (!accountId) return { skipped: true, reason: 'missing_instagram_account_id' };

    const metrics = await this.fetchDemographics(accountId, token);
    await this.snapshots.storeDemographics({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      platform: 'INSTAGRAM',
      country: metrics.country,
      city: metrics.city,
      age: metrics.age,
      gender: metrics.gender,
      activeHours: metrics.activeHours,
      source: 'instagram_graph_api',
    });
    return { demographics: true };
  }

  private async fetchDemographics(accountId: string, token: string) {
    const base = `https://graph.facebook.com/${this.version}`;
    const result: Record<string, any> = {};

    await this.tryInsight(base, accountId, token, 'country', result);
    await this.tryInsight(base, accountId, token, 'city', result);
    await this.tryInsight(base, accountId, token, 'age', result);
    await this.tryInsight(base, accountId, token, 'gender', result);

    if (!result.country || !result.city || !result.age || !result.gender) {
      await this.tryLegacyInsight(base, accountId, token, result);
    }

    return result;
  }

  private async tryInsight(base: string, accountId: string, token: string, breakdown: string, result: Record<string, any>) {
    try {
      const res = await this.withRetry(() => axios.get(`${base}/${accountId}/insights`, {
        params: {
          access_token: token,
          metric: 'follower_demographics',
          period: 'lifetime',
          metric_type: 'total_value',
          breakdown,
        },
      }));
      result[breakdown] = this.extractBreakdown(res.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results || []);
    } catch (err: any) {
      this.logger.warn(`Instagram demographics ${breakdown} unavailable: ${this.errorMessage(err)}`);
    }
  }

  private async tryLegacyInsight(base: string, accountId: string, token: string, result: Record<string, any>) {
    try {
      const res = await this.withRetry(() => axios.get(`${base}/${accountId}/insights`, {
        params: {
          access_token: token,
          metric: 'audience_country,audience_city,audience_gender_age',
          period: 'lifetime',
        },
      }));

      for (const item of res.data?.data || []) {
        const values = item.values?.[0]?.value || {};
        if (item.name === 'audience_country') result.country = values;
        if (item.name === 'audience_city') result.city = values;
        if (item.name === 'audience_gender_age') this.splitGenderAge(values, result);
      }
    } catch (err: any) {
      this.logger.warn(`Instagram legacy demographics unavailable: ${this.errorMessage(err)}`);
    }
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

  private extractBreakdown(rows: any[]) {
    const output: Record<string, number> = {};
    for (const row of rows) {
      const label = row.dimension_values?.join(', ') || row.breakdown_values?.join(', ') || row.name;
      output[label] = Number(row.value || 0);
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
