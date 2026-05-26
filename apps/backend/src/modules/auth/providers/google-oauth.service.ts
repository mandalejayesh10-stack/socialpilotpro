import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleOAuthService implements OnModuleInit {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private configured = false;

  // ── Startup validation ────────────────────────────────────
  onModuleInit() {
    const clientId     = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirectUri  = this.getRedirectUri();

    if (!clientId) {
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.warn('⚠️  GOOGLE_CLIENT_ID is not set in .env');
      this.logger.warn('   Google OAuth login will NOT work.');
      this.logger.warn('   Account: mandalejayesh10@gmail.com');
      this.logger.warn('   Console: https://console.cloud.google.com');
      this.logger.warn(`   Add redirect URI: ${redirectUri}`);
      this.logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.configured = false;
      return;
    }

    if (!clientSecret) {
      this.logger.warn('⚠️  GOOGLE_CLIENT_SECRET is not set in .env');
      this.configured = false;
      return;
    }

    this.configured = true;
    this.logger.log('✅ Google OAuth configured');
    this.logger.log(`   Account:      mandalejayesh10@gmail.com`);
    this.logger.log(`   Client ID:    ${clientId.slice(0, 30)}...`);
    this.logger.log(`   Redirect URI: ${redirectUri}`);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  // ── Always build a fresh client with current BACKEND_INTERNAL_URL ──
  // This ensures the redirect_uri in the auth URL and token exchange
  // always match, even if the env var changes between restarts.
  private buildClient(): OAuth2Client {
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID!.trim(),
      process.env.GOOGLE_CLIENT_SECRET!.trim(),
      this.getRedirectUri(),
    );
  }

  private getRedirectUri(): string {
    const base = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
    return `${base}/api/auth/google/callback`;
  }

  // ── Generate OAuth URL ────────────────────────────────────
  getAuthUrl(state?: string): string {
    if (!this.configured) {
      throw new Error(
        'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env and restart.',
      );
    }

    const client = this.buildClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      prompt: 'consent',
      state,
    });
  }

  // ── Exchange code for user info ───────────────────────────
  async exchangeCode(code: string): Promise<{
    email: string;
    name: string;
    pictureUrl?: string;
    providerId: string;
  }> {
    if (!this.configured) {
      throw new Error('Google OAuth is not configured.');
    }

    const client = this.buildClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID!.trim(),
    });

    const payload = ticket.getPayload();
    if (!payload) throw new Error('Invalid Google token payload');

    return {
      email: payload.email!,
      name: payload.name || payload.email!,
      pictureUrl: payload.picture,
      providerId: payload.sub,
    };
  }
}
