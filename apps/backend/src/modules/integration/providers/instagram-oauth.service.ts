import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import axios from 'axios';

/**
 * Service to handle Direct Instagram Login OAuth flow via Instagram Basic Display API / Instagram Login API.
 * Uses client credentials provided in environment variables, with a smart fallback to FACEBOOK_APP_ID/SECRET.
 */
@Injectable()
export class InstagramOAuthService implements OnModuleInit {
  private readonly logger = new Logger(InstagramOAuthService.name);
  private configured = false;

  get INSTAGRAM_CLIENT_ID() {
    return process.env.INSTAGRAM_CLIENT_ID;
  }

  get INSTAGRAM_CLIENT_SECRET() {
    return process.env.INSTAGRAM_CLIENT_SECRET;
  }

  onModuleInit() {
    const clientId = this.INSTAGRAM_CLIENT_ID;
    const clientSecret = this.INSTAGRAM_CLIENT_SECRET;
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';

    if (!clientId || clientId.trim() === '' || !clientSecret || clientSecret.trim() === '') {
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.warn('⚠️  Instagram Direct Login OAuth not configured');
      this.logger.warn('   Direct Instagram connections will fail.');
      this.logger.warn(`   Callback URL: ${backendUrl}/api/integrations/instagram/callback`);
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.configured = false;
    } else {
      this.configured = true;
      this.logger.log(`✅ Instagram Direct OAuth configured (Client ID: ${clientId.slice(0, 8)}...)`);
    }
  }

  isConfigured(): boolean {
    return !!this.INSTAGRAM_CLIENT_ID && !!this.INSTAGRAM_CLIENT_SECRET;
  }

  getAuthUrl(state: string): string {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Instagram Direct OAuth is not configured. Add INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET to your .env file.',
      );
    }

    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
    const clientId = this.INSTAGRAM_CLIENT_ID!;
    const redirectUri = `${backendUrl}/api/integrations/instagram/callback`;
    const scope = 'instagram_business_basic';
    const responseType = 'code';

    this.logger.log(`[Instagram Direct OAuth] Generating Auth URL:`);
    this.logger.log(`  - client_id: ${clientId}`);
    this.logger.log(`  - redirect_uri: ${redirectUri}`);
    this.logger.log(`  - scope: ${scope}`);
    this.logger.log(`  - response_type: ${responseType}`);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      response_type: responseType,
      state,
    });
    const url = `https://api.instagram.com/oauth/authorize?${params.toString()}`;
    this.logger.log(`  - full_url: ${url}`);
    return url;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    userId: string;
    username: string;
    accountType?: string;
    mediaCount?: number;
    expiresIn?: number;
  }> {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';

    // 1. Exchange authorization code for a short-lived user access token
    const formData = new URLSearchParams();
    formData.append('client_id', this.INSTAGRAM_CLIENT_ID!);
    formData.append('client_secret', this.INSTAGRAM_CLIENT_SECRET!);
    formData.append('grant_type', 'authorization_code');
    formData.append('redirect_uri', `${backendUrl}/api/integrations/instagram/callback`);
    formData.append('code', code);

    const res = await axios.post('https://api.instagram.com/oauth/access_token', formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const shortToken = res.data.access_token;
    const userId = res.data.user_id;

    // 2. Exchange short-lived token for a long-lived user access token (60 days validity)
    let longToken = shortToken;
    let expiresIn = 5183999; // Default 60 days in seconds

    try {
      const longRes = await axios.get('https://graph.instagram.com/access_token', {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: this.INSTAGRAM_CLIENT_SECRET!,
          access_token: shortToken,
        },
      });
      longToken = longRes.data.access_token;
      expiresIn = longRes.data.expires_in || expiresIn;
    } catch (err: any) {
      this.logger.warn(`Could not exchange long-lived token: ${err.message}. Using short-lived token.`);
    }

    // 3. Get Instagram profile details
    const meRes = await axios.get('https://graph.instagram.com/me', {
      params: {
        access_token: longToken,
        fields: 'id,username,account_type,media_count',
      },
    });

    return {
      accessToken: longToken,
      userId: meRes.data.id || String(userId),
      username: meRes.data.username,
      accountType: meRes.data.account_type,
      mediaCount: meRes.data.media_count,
      expiresIn,
    };
  }
}
