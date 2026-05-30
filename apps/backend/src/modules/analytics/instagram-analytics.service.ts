import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { safeDecrypt } from '../../common/utils/crypto.util';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';

@Injectable()
export class InstagramAnalyticsService {
  private readonly logger = new Logger(InstagramAnalyticsService.name);
  private readonly version = process.env.META_API_VERSION || 'v21.0';

  constructor(private snapshots: AnalyticsSnapshotService) {}

  async syncDemographics(integration: any) {
    // Prefer pageAccessToken for Instagram — it's the page-scoped token with IG permissions
    const rawToken = integration.pageAccessToken || integration.accessToken;
    const token = safeDecrypt(rawToken);
    const accountId = integration.internalId;
    if (!accountId) return { skipped: true, reason: 'missing_instagram_account_id' };
    if (!token) {
      this.logger.error(`[syncDemographics] Token decryption failed for integration ${integration.id} — skipping`);
      return { skipped: true, reason: 'token_decryption_failed' };
    }

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

Service: InstagramAnalyticsService
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

  private async tryInsight(base: string, accountId: string, token: string, breakdown: string, result: Record<string, any>) {
    const url = `${base}/${accountId}/insights`;
    try {
      const res = await this.withRetry(() => axios.get(url, {
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
      this.handleFailedInstagramApiCall(
        err,
        'tryInsight',
        `${url}?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}`,
        accountId,
        token,
        {
          metrics: 'follower_demographics',
          period: 'lifetime',
          insight_type: 'follower_demographics',
        }
      );
    }
  }

  private async tryLegacyInsight(base: string, accountId: string, token: string, result: Record<string, any>) {
    const url = `${base}/${accountId}/insights`;
    try {
      const res = await this.withRetry(() => axios.get(url, {
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
      this.handleFailedInstagramApiCall(
        err,
        'tryLegacyInsight',
        `${url}?metric=audience_country,audience_city,audience_gender_age&period=lifetime`,
        accountId,
        token,
        {
          metrics: 'audience_country,audience_city,audience_gender_age',
          period: 'lifetime',
        }
      );
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
