import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class YoutubeOAuthService implements OnModuleInit {
  private readonly logger = new Logger(YoutubeOAuthService.name);
  private configured = false;
  readonly requiredScopes = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  ];

  onModuleInit() {
    const clientId     = process.env.YOUTUBE_CLIENT_ID?.trim();
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
    const redirectUri  = this.getRedirectUri();

    if (!clientId || !clientSecret) {
      this.logger.warn('⚠️  YouTube OAuth not configured (YOUTUBE_CLIENT_ID/SECRET missing). See SETUP_OAUTH.md.');
      this.configured = false;
    } else {
      this.configured = true;
      this.logger.log('✅ YouTube OAuth configured');
      this.logger.log(`   Account:      mandalejayesh10@gmail.com`);
      this.logger.log(`   Client ID:    ${clientId.slice(0, 30)}...`);
      this.logger.log(`   Redirect URI: ${redirectUri}`);
    }
  }

  isConfigured(): boolean { return this.configured; }

  private getRedirectUri(): string {
    const base = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
    return `${base}/api/integrations/youtube/callback`;
  }

  // ── Always build a fresh client with current BACKEND_INTERNAL_URL ──
  private createClient(): OAuth2Client {
    return new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID!.trim(),
      process.env.YOUTUBE_CLIENT_SECRET!.trim(),
      this.getRedirectUri(),
    );
  }

  // ── OAuth URL ─────────────────────────────────────────────
  getAuthUrl(state: string): string {
    if (!this.configured) {
      throw new BadRequestException(
        'YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env. See SETUP_OAUTH.md.',
      );
    }
    const client = this.createClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        ...this.requiredScopes,
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'consent',
      state,
    });
  }

  // ── Exchange code for tokens ──────────────────────────────
  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiryDate: Date;
    channelId: string;
    channelName: string;
    pictureUrl?: string;
    subscriberCount?: number;
    grantedScopes: string[];
  }> {
    const client = this.createClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: client });
    const channelRes = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = channelRes.data.items?.[0];
    if (!channel) throw new Error('No YouTube channel found for this account');

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: new Date(tokens.expiry_date!),
      channelId: channel.id!,
      channelName: channel.snippet?.title || 'YouTube Channel',
      pictureUrl: channel.snippet?.thumbnails?.default?.url,
      subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
      grantedScopes: String(tokens.scope || '').split(/\s+/).filter(Boolean),
    };
  }

  // ── Refresh access token ──────────────────────────────────
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    expiryDate: Date;
  }> {
    const client = this.createClient();
    client.setCredentials({ refresh_token: refreshToken });
    let credentials;
    try {
      ({ credentials } = await client.refreshAccessToken());
    } catch (err: any) {
      if (err?.response?.data?.error === 'invalid_grant' || err?.message?.includes('invalid_grant')) {
        throw new BadRequestException('YouTube authorization expired or was revoked. Reconnect YouTube and grant analytics scopes.');
      }
      throw err;
    }

    return {
      accessToken: credentials.access_token!,
      expiryDate: new Date(credentials.expiry_date!),
    };
  }

  getMissingScopes(grantedScopes: string[] = []) {
    return this.requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  }

  // ── Get channel info ──────────────────────────────────────
  async getChannelInfo(accessToken: string): Promise<{
    channelId: string;
    channelName: string;
    subscriberCount: number;
    videoCount: number;
    viewCount: number;
  }> {
    const client = this.createClient();
    client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({ version: 'v3', auth: client });
    const res = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = res.data.items?.[0];
    if (!channel) throw new Error('Channel not found');

    return {
      channelId: channel.id!,
      channelName: channel.snippet?.title || '',
      subscriberCount: parseInt(channel.statistics?.subscriberCount || '0'),
      videoCount: parseInt(channel.statistics?.videoCount || '0'),
      viewCount: parseInt(channel.statistics?.viewCount || '0'),
    };
  }
}
