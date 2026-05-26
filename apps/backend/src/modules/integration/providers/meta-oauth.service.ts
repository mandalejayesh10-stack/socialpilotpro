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

  // ── Get Facebook Pages ────────────────────────────────────
  async getPages(userToken: string): Promise<Array<{
    id: string;
    name: string;
    accessToken: string;
    pictureUrl?: string;
    category?: string;
  }>> {
    const res = await axios.get(`${this.BASE_URL}/me/accounts`, {
      params: {
        access_token: userToken,
        fields: 'id,name,access_token,picture,category',
      },
    });

    return res.data.data.map((page: any) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      pictureUrl: page.picture?.data?.url,
      category: page.category,
    }));
  }

  // ── Get Instagram Business Account linked to a Page ───────
  async getInstagramAccount(pageId: string, pageToken: string): Promise<{
    id: string;
    name: string;
    username: string;
    pictureUrl?: string;
    followersCount?: number;
    accountType?: string;
  } | null> {
    try {
      const res = await axios.get(`${this.BASE_URL}/${pageId}`, {
        params: {
          access_token: pageToken,
          fields: 'instagram_business_account{id,name,username,profile_picture_url,followers_count,account_type}',
        },
      });

      const ig = res.data.instagram_business_account;
      if (!ig) return null;

      return {
        id: ig.id,
        name: ig.name,
        username: ig.username,
        pictureUrl: ig.profile_picture_url,
        followersCount: ig.followers_count,
        accountType: ig.account_type,
      };
    } catch {
      this.logger.warn(`No Instagram account for page ${pageId}`);
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
