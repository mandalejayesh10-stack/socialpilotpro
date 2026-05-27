import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MetaOAuthService implements OnModuleInit {
  private readonly logger = new Logger(MetaOAuthService.name);
  private configured = false;
  readonly requiredInsightPermissions = [
    'pages_read_engagement',
    'read_insights',
    'pages_show_list',
    'business_management',
    'instagram_basic',
    'instagram_manage_insights',
  ];

  get META_VERSION() { return process.env.META_API_VERSION || 'v21.0'; }
  get BASE_URL() { return `https://graph.facebook.com/${this.META_VERSION}`; }

  onModuleInit() {
    const appId     = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';

    if (!appId || appId.trim() === '' || !appSecret || appSecret.trim() === '') {
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.warn('⚠️  Meta (Facebook/Instagram) OAuth not configured');
      this.logger.warn('   Instagram and Facebook connections will NOT work.');
      this.logger.warn('');
      this.logger.warn('   How to fix:');
      this.logger.warn('   1. Go to https://developers.facebook.com');
      this.logger.warn('   2. Create App → Business type');
      this.logger.warn('   3. Add Facebook Login + Instagram Graph API products');
      this.logger.warn(`   4. Add redirect URI: ${backendUrl}/api/integrations/meta/callback`);
      this.logger.warn('   5. Add to .env:');
      this.logger.warn('      FACEBOOK_APP_ID=your_app_id');
      this.logger.warn('      FACEBOOK_APP_SECRET=your_app_secret');
      this.logger.warn('   See SETUP_META.md for full guide');
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.configured = false;
    } else {
      this.configured = true;
      this.logger.log(`✅ Meta OAuth configured (App ID: ${appId.slice(0, 8)}...)`);
    }
  }

  isConfigured(): boolean { return this.configured; }

  // ── OAuth URL ─────────────────────────────────────────────
  getAuthUrl(state: string): string {
    if (!this.configured) {
      throw new BadRequestException(
        'Meta OAuth is not configured. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to .env. See SETUP_META.md.',
      );
    }

    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      redirect_uri: `${backendUrl}/api/integrations/meta/callback`,
      scope: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_insights',
        'instagram_manage_comments',
        'read_insights',
        'business_management',
      ].join(','),
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/dialog/oauth?${params.toString()}`;
  }

  // ── Exchange code for long-lived token ────────────────────
  async exchangeCode(code: string): Promise<{
    accessToken: string;
    userId: string;
    name: string;
    permissions: string[];
  }> {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';

    const res = await axios.get(`${this.BASE_URL}/oauth/access_token`, {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: `${backendUrl}/api/integrations/meta/callback`,
        code,
      },
    });

    const shortToken = res.data.access_token;

    // Exchange for long-lived token (60 days)
    const longRes = await axios.get(`${this.BASE_URL}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: shortToken,
      },
    });

    const longToken = longRes.data.access_token;

    // Get user info
    const meRes = await axios.get(`${this.BASE_URL}/me`, {
      params: { access_token: longToken, fields: 'id,name' },
    });

    return {
      accessToken: longToken,
      userId: meRes.data.id,
      name: meRes.data.name,
      permissions: await this.getGrantedPermissions(longToken),
    };
  }

  // ── Get Facebook Pages (with embedded Instagram data) ───────
  async getPages(userToken: string): Promise<Array<{
    id: string;
    name: string;
    accessToken: string;
    pictureUrl?: string;
    category?: string;
    instagramBusinessAccountId?: string;
    connectedInstagramAccountId?: string;
  }>> {
    if (!userToken) {
      this.logger.error('[getPages] User token is null/empty — cannot fetch pages');
      return [];
    }
    this.logger.log(`[getPages] Fetching pages with token: ${userToken.slice(0, 8)}...`);

    // Request instagram_business_account AND connected_instagram_account in the same call
    const url = `${this.BASE_URL}/me/accounts`;
    const fields = 'id,name,access_token,picture,category,instagram_business_account,connected_instagram_account';
    this.logger.log(`[getPages] GET ${url}?fields=${fields}`);

    const res = await axios.get(url, {
      params: { access_token: userToken, fields },
    });

    const rawPages = res.data.data || [];
    this.logger.log(`[getPages] Raw /me/accounts response: ${rawPages.length} pages`);

    const pages = rawPages.map((page: any) => {
      const igBiz  = page.instagram_business_account;
      const igConn = page.connected_instagram_account;

      this.logger.log(
        `[getPages] Page payload: id=${page.id}, name="${page.name}", ` +
        `has_access_token=${!!page.access_token}, ` +
        `instagram_business_account=${igBiz ? igBiz.id : 'NONE'}, ` +
        `connected_instagram_account=${igConn ? igConn.id : 'NONE'}`,
      );

      return {
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        pictureUrl: page.picture?.data?.url,
        category: page.category,
        instagramBusinessAccountId: igBiz?.id || null,
        connectedInstagramAccountId: igConn?.id || null,
      };
    });

    this.logger.log(`[getPages] Mapped ${pages.length} pages. Pages with IG biz account: ${pages.filter((p: any) => p.instagramBusinessAccountId).length}, Pages with connected IG: ${pages.filter((p: any) => p.connectedInstagramAccountId).length}`);
    return pages;
  }

  // ── Get Instagram Business Account linked to a Page ───────
  // Tries instagram_business_account first, falls back to connected_instagram_account
  async getInstagramAccount(
    pageId: string,
    pageToken: string,
    hintIgBizId?: string | null,
    hintIgConnId?: string | null,
  ): Promise<{
    id: string;
    name: string;
    username: string;
    pictureUrl?: string;
    followersCount?: number;
    accountType?: string;
  } | null> {
    if (!pageToken) {
      this.logger.error(`[getInstagramAccount] Page token is null/empty for page ${pageId} — skipping`);
      return null;
    }

    this.logger.log(
      `[getInstagramAccount] page=${pageId}, hintIgBizId=${hintIgBizId || 'none'}, hintIgConnId=${hintIgConnId || 'none'}, token=${pageToken.slice(0, 8)}...`,
    );

    // Strategy 1: we already know the IG ID from the /me/accounts response
    const knownIgId = hintIgBizId || hintIgConnId;
    if (knownIgId) {
      this.logger.log(`[getInstagramAccount] Using pre-discovered IG id=${knownIgId} (${hintIgBizId ? 'business' : 'connected'})`);
      const detail = await this.fetchInstagramDetails(knownIgId, pageToken);
      if (detail) return detail;
      this.logger.warn(`[getInstagramAccount] Direct fetch of ${knownIgId} failed — falling back to page query`);
    }

    // Strategy 2: query /{page-id} with both fields
    try {
      const url = `${this.BASE_URL}/${pageId}`;
      const fields = 'instagram_business_account{id,name,username,profile_picture_url,followers_count,account_type},connected_instagram_account{id,name,username,profile_picture_url,followers_count,account_type}';
      this.logger.log(`[getInstagramAccount] GET ${url}?fields=${fields}`);

      const res = await axios.get(url, {
        params: { access_token: pageToken, fields },
      });

      this.logger.log(`[getInstagramAccount] /${pageId} response keys: ${Object.keys(res.data).join(', ')}`);
      this.logger.log(`[getInstagramAccount] Raw response: ${JSON.stringify(res.data)}`);

      // Prefer instagram_business_account, fall back to connected_instagram_account
      const ig = res.data.instagram_business_account || res.data.connected_instagram_account;
      const igSource = res.data.instagram_business_account ? 'instagram_business_account' : 'connected_instagram_account';

      if (!ig) {
        this.logger.warn(
          `[getInstagramAccount] No instagram_business_account or connected_instagram_account for page ${pageId}. ` +
          `This page may not have an Instagram account linked, or the app may lack instagram_basic permission.`,
        );
        return null;
      }

      this.logger.log(
        `[getInstagramAccount] Found via ${igSource}: id=${ig.id}, username=${ig.username}, followers=${ig.followers_count}, account_type=${ig.account_type}`,
      );

      return {
        id: ig.id,
        name: ig.name || ig.username || pageId,
        username: ig.username,
        pictureUrl: ig.profile_picture_url,
        followersCount: ig.followers_count,
        accountType: ig.account_type,
      };
    } catch (err: any) {
      const errData = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[getInstagramAccount] Page query failed for ${pageId}: ${errData}`);
      return null;
    }
  }

  // Fetch full Instagram account details by IG account ID
  private async fetchInstagramDetails(igId: string, token: string) {
    try {
      const res = await axios.get(`${this.BASE_URL}/${igId}`, {
        params: {
          access_token: token,
          fields: 'id,name,username,profile_picture_url,followers_count,account_type',
        },
      });
      const ig = res.data;
      this.logger.log(`[fetchInstagramDetails] id=${ig.id}, username=${ig.username}, followers=${ig.followers_count}`);
      return {
        id: ig.id,
        name: ig.name || ig.username || igId,
        username: ig.username,
        pictureUrl: ig.profile_picture_url,
        followersCount: ig.followers_count,
        accountType: ig.account_type,
      };
    } catch (err: any) {
      const errData = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[fetchInstagramDetails] Failed for IG id=${igId}: ${errData}`);
      return null;
    }
  }

  // ── Refresh long-lived token ──────────────────────────────
  async refreshToken(token: string): Promise<{ accessToken: string; expiresIn: number }> {
    const res = await axios.get(`${this.BASE_URL}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: token,
      },
    });

    return {
      accessToken: res.data.access_token,
      expiresIn: res.data.expires_in || 5184000,
    };
  }

  // ── Validate token ────────────────────────────────────────
  async validateToken(token: string): Promise<boolean> {
    try {
      const res = await axios.get(`${this.BASE_URL}/me`, {
        params: { access_token: token, fields: 'id' },
      });
      return !!res.data.id;
    } catch {
      return false;
    }
  }

  async getGrantedPermissions(token: string): Promise<string[]> {
    try {
      const res = await axios.get(`${this.BASE_URL}/me/permissions`, {
        params: { access_token: token },
      });
      return (res.data.data || [])
        .filter((item: any) => item.status === 'granted')
        .map((item: any) => item.permission);
    } catch (err: any) {
      this.logger.warn(`Unable to read Meta permissions: ${err.message}`);
      return [];
    }
  }

  getMissingInsightPermissions(granted: string[] = []) {
    return this.requiredInsightPermissions.filter((permission) => !granted.includes(permission));
  }

  // ── Fetch basic stats ─────────────────────────────────────
  async fetchBasicStats(platform: string, accountId: string, token: string) {
    const fields = platform === 'INSTAGRAM'
      ? 'followers_count,follows_count,media_count,name,username,profile_picture_url'
      : 'fan_count,name,picture,category';
    const res = await axios.get(`${this.BASE_URL}/${accountId}`, {
      params: { access_token: token, fields },
    });
    return res.data;
  }

  // ── Fetch post insights ───────────────────────────────────
  async fetchPostInsights(mediaIds: string[], token: string) {
    const results: Record<string, any> = {};
    for (const id of mediaIds) {
      try {
        const res = await axios.get(`${this.BASE_URL}/${id}/insights`, {
          params: { access_token: token, metric: 'impressions,reach,likes,comments,shares,saved,video_views' },
        });
        results[id] = this.parseInsights(res.data.data);
      } catch (e: any) {
        this.logger.warn(`Post insights [${id}]: ${e.message}`);
      }
    }
    return results;
  }

  async fetchPagePostInsights(postIds: string[], token: string) {
    const results: Record<string, any> = {};
    for (const id of postIds) {
      try {
        const res = await axios.get(`${this.BASE_URL}/${id}/insights`, {
          params: { access_token: token, metric: 'post_impressions,post_reach,post_reactions_by_type_total,post_clicks' },
        });
        results[id] = this.parseInsights(res.data.data);
      } catch (e: any) {
        this.logger.warn(`Page post insights [${id}]: ${e.message}`);
      }
    }
    return results;
  }

  async fetchInstagramInsights(accountId: string, token: string) {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const until = Math.floor(Date.now() / 1000);
    const res = await axios.get(`${this.BASE_URL}/${accountId}/insights`, {
      params: { access_token: token, metric: 'impressions,reach,follower_count,profile_views', period: 'day', since, until },
    });
    return res.data.data;
  }

  async fetchPageInsights(pageId: string, token: string) {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const until = Math.floor(Date.now() / 1000);
    const res = await axios.get(`${this.BASE_URL}/${pageId}/insights`, {
      params: { access_token: token, metric: 'page_impressions,page_reach,page_fans,page_engaged_users', period: 'day', since, until },
    });
    return res.data.data;
  }

  private parseInsights(data: any[]): Record<string, number> {
    const r: Record<string, number> = {};
    for (const item of data || []) {
      const v = item.values?.[0]?.value;
      r[item.name] = typeof v === 'object'
        ? Object.values(v as any).reduce((a: any, b: any) => a + b, 0) as number
        : v || item.value || 0;
    }
    return r;
  }
}
