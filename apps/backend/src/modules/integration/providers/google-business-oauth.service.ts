import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleBusinessOAuthService implements OnModuleInit {
  private readonly logger = new Logger(GoogleBusinessOAuthService.name);
  private configured = false;
  readonly requiredScopes = [
    'https://www.googleapis.com/auth/business.manage',
  ];

  onModuleInit() {
    const clientId     = (process.env.GOOGLE_BUSINESS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)?.trim();
    const clientSecret = (process.env.GOOGLE_BUSINESS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)?.trim();
    const redirectUri  = this.getRedirectUri();

    if (!clientId || !clientSecret) {
      this.logger.warn('⚠️  Google Business OAuth not configured (GOOGLE_BUSINESS_CLIENT_ID/SECRET missing).');
      this.configured = false;
    } else {
      this.configured = true;
      this.logger.log('✅ Google Business OAuth configured');
      this.logger.log(`   Redirect URI: ${redirectUri}`);
    }
  }

  isConfigured(): boolean { return this.configured; }

  private getRedirectUri(): string {
    const base = process.env.FRONTEND_URL || 'http://localhost:4200';
    return `${base}/api/integrations/google-business/callback`;
  }

  private createClient(): OAuth2Client {
    const clientId     = (process.env.GOOGLE_BUSINESS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)!.trim();
    const clientSecret = (process.env.GOOGLE_BUSINESS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)!.trim();
    return new google.auth.OAuth2(
      clientId,
      clientSecret,
      this.getRedirectUri(),
    );
  }

  getAuthUrl(state: string): string {
    if (!this.configured) {
      throw new BadRequestException('Google Business OAuth is not configured.');
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

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiryDate: Date;
    profileId: string;
    profileName: string;
    pictureUrl?: string;
  }> {
    const client = this.createClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user profile details
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userinfo = await oauth2.userinfo.get();

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: new Date(tokens.expiry_date!),
      profileId: userinfo.data.id || '',
      profileName: userinfo.data.name || 'Google Business Account',
      pictureUrl: userinfo.data.picture || undefined,
    };
  }

  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    expiryDate: Date;
  }> {
    const client = this.createClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      expiryDate: new Date(credentials.expiry_date!),
    };
  }
}
