import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class LinkedinOAuthService implements OnModuleInit {
  private readonly logger = new Logger(LinkedinOAuthService.name);
  private configured = false;

  onModuleInit() {
    const clientId     = process.env.LINKEDIN_CLIENT_ID?.trim();
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
    const redirectUri  = this.getRedirectUri();

    if (!clientId || !clientSecret) {
      this.logger.warn('⚠️  LinkedIn OAuth not configured (LINKEDIN_CLIENT_ID/SECRET missing).');
      this.configured = false;
    } else {
      this.configured = true;
      this.logger.log('✅ LinkedIn OAuth configured');
      this.logger.log(`   Redirect URI: ${redirectUri}`);
    }
  }

  isConfigured(): boolean { return this.configured; }

  private getRedirectUri(): string {
    const base = process.env.FRONTEND_URL || 'http://localhost:4200';
    return `${base}/api/integrations/linkedin/callback`;
  }

  getAuthUrl(state: string): string {
    if (!this.configured) {
      throw new BadRequestException('LinkedIn OAuth is not configured.');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID!.trim(),
      redirect_uri: this.getRedirectUri(),
      state,
      scope: 'openid profile email w_member_social w_organization_social',
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
    profileId: string;
    profileName: string;
    pictureUrl?: string;
    email?: string;
  }> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID!.trim(),
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!.trim(),
      redirect_uri: this.getRedirectUri(),
    });

    const res = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const accessToken = res.data.access_token;
    const expiresIn = res.data.expires_in;

    // Get user info via OpenID Connect endpoint
    const profileRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profileData = profileRes.data;

    return {
      accessToken,
      expiresIn,
      profileId: profileData.sub,
      profileName: profileData.name || `${profileData.given_name} ${profileData.family_name}`,
      pictureUrl: profileData.picture,
      email: profileData.email,
    };
  }
}
