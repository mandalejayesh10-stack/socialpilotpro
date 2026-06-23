import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ThreadsOAuthService implements OnModuleInit {
  private readonly logger = new Logger(ThreadsOAuthService.name);
  private configured = false;

  onModuleInit() {
    const clientId     = process.env.THREADS_CLIENT_ID?.trim();
    const clientSecret = process.env.THREADS_CLIENT_SECRET?.trim();
    const redirectUri  = this.getRedirectUri();

    if (!clientId || !clientSecret) {
      this.logger.warn('⚠️  Threads OAuth not configured (THREADS_CLIENT_ID/SECRET missing).');
      this.configured = false;
    } else {
      this.configured = true;
      this.logger.log('✅ Threads OAuth configured');
      this.logger.log(`   Redirect URI: ${redirectUri}`);
    }
  }

  isConfigured(): boolean { return this.configured; }

  private getRedirectUri(): string {
    const base = process.env.FRONTEND_URL || 'http://localhost:4200';
    return `${base}/api/integrations/threads/callback`;
  }

  getAuthUrl(state: string): string {
    if (!this.configured) {
      throw new BadRequestException('Threads OAuth is not configured.');
    }
    const params = new URLSearchParams({
      client_id: process.env.THREADS_CLIENT_ID!.trim(),
      redirect_uri: this.getRedirectUri(),
      state,
      scope: 'threads_basic,threads_content_publish,threads_manage_insights',
      response_type: 'code',
    });
    return `https://threads.net/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
    profileId: string;
    profileName: string;
    pictureUrl?: string;
  }> {
    // 1. Get short-lived user access token
    const formData = new URLSearchParams();
    formData.append('client_id', process.env.THREADS_CLIENT_ID!.trim());
    formData.append('client_secret', process.env.THREADS_CLIENT_SECRET!.trim());
    formData.append('grant_type', 'authorization_code');
    formData.append('redirect_uri', this.getRedirectUri());
    formData.append('code', code);

    const res = await axios.post('https://graph.threads.net/oauth/access_token', formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const shortToken = res.data.access_token;
    const profileId = res.data.user_id;

    // 2. Exchange for long-lived access token (60 days)
    const longRes = await axios.get('https://graph.threads.net/access_token', {
      params: {
        grant_type: 'th_exchange_token',
        client_secret: process.env.THREADS_CLIENT_SECRET!.trim(),
        access_token: shortToken,
      },
    });

    const accessToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in;

    // 3. Fetch Threads profile details
    const profileRes = await axios.get('https://graph.threads.net/v1.0/me', {
      params: {
        fields: 'id,username,threads_profile_picture_url,name',
        access_token: accessToken,
      },
    });

    const profileData = profileRes.data;

    return {
      accessToken,
      expiresIn,
      profileId,
      profileName: profileData.name || profileData.username,
      pictureUrl: profileData.threads_profile_picture_url,
    };
  }
}
