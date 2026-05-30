import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const META_VERSION = process.env.META_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${META_VERSION}`;

@Injectable()
export class MetaFetcherService {
  private readonly logger = new Logger(MetaFetcherService.name);
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
        const status = err?.response?.status;
        const transient = status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT'].includes(err?.code);
        if (!transient || attempt === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
    throw lastError;
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

Service: MetaFetcherService
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

  // ── Basic stats (followers, profile info) ─────────────────
  async fetchBasicStats(platform: string, accountId: string, token: string) {
    if (platform === 'INSTAGRAM') {
      const isDirect = token.startsWith('IGQ') || token.startsWith('IG');
      const BASE_URL = isDirect ? 'https://graph.instagram.com' : BASE;

      return this.getCached(`ig:basic:${accountId}`, 5 * 60 * 1000, async () => {
        try {
          const res = await axios.get(`${BASE_URL}/${accountId}`, {
            params: {
              access_token: token,
              fields: isDirect
                ? 'id,username,media_count,account_type'
                : 'followers_count,follows_count,media_count,name,username,profile_picture_url,biography,website',
            },
          });
          return res.data;
        } catch (err: any) {
          this.handleFailedInstagramApiCall(
            err,
            'fetchBasicStats',
            `${BASE_URL}/${accountId}?fields=${isDirect ? 'id,username,media_count,account_type' : 'followers_count,follows_count,media_count,name,username,profile_picture_url,biography,website'}`,
            accountId,
            token,
            {
              fields: isDirect ? 'id,username,media_count,account_type' : 'followers_count,follows_count,media_count,name,username,profile_picture_url,biography,website',
            }
          );
        }
      });
    }

    if (platform === 'FACEBOOK') {
      return this.getCached(`fb:basic:${accountId}`, 5 * 60 * 1000, async () => {
      const res = await axios.get(`${BASE}/${accountId}`, {
        params: {
          access_token: token,
          fields: 'fan_count,followers_count,name,picture,category,about,website',
        },
      });
      return res.data;
      });
    }

    return {};
  }

  // ── Instagram post insights ───────────────────────────────
  async fetchPostInsights(mediaIds: string[], token: string) {
    const isDirect = token.startsWith('IGQ') || token.startsWith('IG');
    if (isDirect) {
      return {};
    }
    const results: Record<string, any> = {};

    // Batch in groups of 50
    const batches = this.chunk(mediaIds, 50);
    for (const batch of batches) {
      for (const mediaId of batch) {
        try {
          const res = await this.getCached(`ig:post:${mediaId}`, 10 * 60 * 1000, async () => {
            try {
              return await axios.get(`${BASE}/${mediaId}/insights`, {
                params: {
                  access_token: token,
                  metric: 'impressions,reach,likes,comments,shares,saved,video_views,plays,total_interactions',
                },
              });
            } catch (err: any) {
              this.handleFailedInstagramApiCall(
                err,
                'fetchPostInsights',
                `${BASE}/${mediaId}/insights?metric=impressions,reach,likes,comments,shares,saved,video_views,plays,total_interactions`,
                mediaId,
                token,
                {
                  metrics: 'impressions,reach,likes,comments,shares,saved,video_views,plays,total_interactions',
                  media_id: mediaId,
                }
              );
            }
          });
          results[mediaId] = this.parseInsights(res.data.data);
        } catch (err: any) {
          throw err;
        }
      }
    }

    return results;
  }

  // ── Facebook page post insights ───────────────────────────
  async fetchPagePostInsights(postIds: string[], token: string) {
    const results: Record<string, any> = {};

    for (const postId of postIds) {
      try {
        const res = await this.getCached(`fb:post:${postId}`, 10 * 60 * 1000, async () => axios.get(`${BASE}/${postId}/insights`, {
          params: {
            access_token: token,
            metric: 'post_impressions,post_reach,post_reactions_by_type_total,post_clicks,post_engaged_users,post_video_views',
          },
        }));
        results[postId] = this.parseInsights(res.data.data);
      } catch (err) {
        this.logger.warn(`Failed to fetch page post insights for ${postId}: ${err.message}`);
      }
    }

    return results;
  }

  // ── Instagram account insights (daily) ───────────────────
  async fetchInstagramInsights(accountId: string, token: string) {
    const isDirect = token.startsWith('IGQ') || token.startsWith('IG');
    if (isDirect) {
      return [];
    }
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const until = Math.floor(Date.now() / 1000);

    const res = await this.getCached(`ig:insights:${accountId}`, 10 * 60 * 1000, async () => {
      try {
        return await axios.get(`${BASE}/${accountId}/insights`, {
          params: {
            access_token: token,
            metric: 'impressions,reach,follower_count,profile_views,website_clicks,total_interactions,accounts_engaged',
            period: 'day',
            since,
            until,
          },
        });
      } catch (err: any) {
        this.handleFailedInstagramApiCall(
          err,
          'fetchInstagramInsights',
          `${BASE}/${accountId}/insights?metric=impressions,reach,follower_count,profile_views,website_clicks,total_interactions,accounts_engaged&period=day&since=${since}&until=${until}`,
          accountId,
          token,
          {
            metrics: 'impressions,reach,follower_count,profile_views,website_clicks,total_interactions,accounts_engaged',
            period: 'day',
          }
        );
      }
    });

    return res.data.data;
  }

  // ── Facebook page insights (daily) ───────────────────────
  async fetchPageInsights(pageId: string, token: string) {
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const until = Math.floor(Date.now() / 1000);

    const res = await this.getCached(`fb:insights:${pageId}`, 10 * 60 * 1000, async () => axios.get(`${BASE}/${pageId}/insights`, {
      params: {
        access_token: token,
        metric: 'page_impressions,page_reach,page_fans,page_fan_adds_unique,page_engaged_users,page_video_views',
        period: 'day',
        since,
        until,
      },
    }));

    return res.data.data;
  }

  async fetchInstagramMedia(accountId: string, token: string) {
    const isDirect = token.startsWith('IGQ') || token.startsWith('IG');
    const BASE_URL = isDirect ? 'https://graph.instagram.com' : BASE;

    return this.getCached(`ig:media:${accountId}`, 10 * 60 * 1000, async () => {
      try {
        const res = await axios.get(`${BASE_URL}/${accountId}/media`, {
          params: {
            access_token: token,
            fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink',
            limit: 50,
          },
        });
        return res.data.data || [];
      } catch (err: any) {
        this.handleFailedInstagramApiCall(
          err,
          'fetchInstagramMedia',
          `${BASE_URL}/${accountId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink&limit=50`,
          accountId,
          token,
          {
            fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink',
          }
        );
      }
    });
  }

  async fetchFacebookPosts(pageId: string, token: string) {
    return this.getCached(`fb:posts:${pageId}`, 10 * 60 * 1000, async () => {
      const res = await axios.get(`${BASE}/${pageId}/posts`, {
        params: {
          access_token: token,
          fields: 'id,message,story,created_time,full_picture,permalink_url,reactions.summary(true),comments.summary(true),shares',
          limit: 50,
        },
      });
      return res.data.data || [];
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  private parseInsights(data: any[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of data || []) {
      result[item.name] = typeof item.values?.[0]?.value === 'object'
        ? Object.values(item.values[0].value as Record<string, number>).reduce((a, b) => a + b, 0)
        : item.values?.[0]?.value || item.value || 0;
    }
    return result;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
