import {
  Controller, Post, Get, Body, Query,
  Res, UseGuards, HttpCode, HttpStatus, Patch, Logger,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './providers/google-oauth.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private googleOAuth: GoogleOAuthService,
    private tokenService: TokenService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register with email + password' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setTokenCookie(res, (result as any).token);
    return result;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    this.setTokenCookie(res, (result as any).token);
    return result;
  }

  @Public()
  @Get('google/status')
  @ApiOperation({ summary: 'Check if Google OAuth is configured' })
  googleStatus() {
    const redirectBase = process.env.FRONTEND_URL || 'http://localhost:4200';
    return {
      configured: this.googleOAuth.isConfigured(),
      account: 'mandalejayesh10@gmail.com',
      redirectUri: `${redirectBase}/api/auth/google/callback`,
      addToGoogleConsole: [
        `${redirectBase}/api/auth/google/callback`,
        `http://localhost:4200/api/auth/google/callback`,
      ],
    };
  }

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Redirect to Google OAuth' })
  googleAuth(@Req() _req: Request, @Res() res: Response) {    if (!this.googleOAuth.isConfigured()) {
      // Return a helpful HTML error page instead of crashing
      return res.status(503).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Google OAuth Not Configured</title>
        <style>
          body { font-family: system-ui; background: #0f0f1a; color: #f0f0ff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .card { background: #16162a; border: 1px solid #2a2a45; border-radius: 16px; padding: 40px; max-width: 520px; }
          h1 { color: #ef4444; margin-top: 0; }
          code { background: #1a1a30; padding: 2px 8px; border-radius: 4px; font-family: monospace; color: #818cf8; }
          .step { margin: 8px 0; padding: 8px 12px; background: #1a1a30; border-radius: 8px; font-size: 14px; }
          a { color: #818cf8; }
          .back { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 10px; text-decoration: none; }
        </style>
        </head>
        <body>
          <div class="card">
            <h1>⚠️ Google OAuth Not Configured</h1>
            <p>The <code>GOOGLE_CLIENT_ID</code> is missing from your <code>.env</code> file.</p>
            <p><strong>To fix this:</strong></p>
            <div class="step">1. Go to <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a></div>
            <div class="step">2. Create a project → APIs & Services → Credentials</div>
            <div class="step">3. Create OAuth 2.0 Client ID (Web application type)</div>
            <div class="step">4. Add Authorized redirect URI:<br><code>${process.env.FRONTEND_URL || 'http://localhost:4200'}/api/auth/google/callback</code></div>
            <div class="step">5. Add to your <code>.env</code> file:<br>
              <code>GOOGLE_CLIENT_ID=your_client_id</code><br>
              <code>GOOGLE_CLIENT_SECRET=your_client_secret</code>
            </div>
            <div class="step">6. Restart the backend server</div>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:4200'}/login" class="back">← Back to Login</a>
          </div>
        </body>
        </html>
      `);
    }

    const csrfState = this.createOAuthCsrfState();
    res.cookie('oauth_state', csrfState, {
      ...this.cookieOptions(),
      maxAge: 10 * 60 * 1000,
    });
    const url = this.googleOAuth.getAuthUrl(csrfState);
    res.redirect(url);
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Query('code') code: string,
    @Query('error') oauthError: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Handle OAuth errors (user denied, etc.)
    if (oauthError) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      return res.redirect(`${frontendUrl}/login?error=No+authorization+code+received`);
    }

    try {
      this.verifyOAuthCsrfState(state, req.cookies?.oauth_state);
      const googleUser = await this.googleOAuth.exchangeCode(code);
      const result = await this.authService.googleAuth(googleUser) as any;
      this.setTokenCookie(res, result.token);
      res.clearCookie('oauth_state', this.cookieOptions());

      // CRITICAL: Always redirect to THIS app's frontend, never to any other URL
      // FRONTEND_URL must be set to http://localhost:4200 (dev) or your Vercel URL (prod)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      this.logger.log(`[Google OAuth] Login success for ${googleUser.email} → redirecting to ${frontendUrl}`);
      res.redirect(`${frontendUrl}/auth/callback?login=success`);
    } catch (err: any) {
      this.logger.error(`[Google OAuth] Callback error: ${err.message}`);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(err.message)}`);
    }
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.id);
  }

  @Patch('password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token', this.cookieOptions());
    return { message: 'Logged out successfully' };
  }

  private setTokenCookie(res: Response, token: string) {
    res.cookie('token', token, {
      ...this.cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    } as const;
  }

  private createOAuthCsrfState(): string {
    const nonce = crypto.randomBytes(24).toString('base64url');
    const expires = Date.now() + 10 * 60 * 1000;
    const payload = Buffer.from(JSON.stringify({ nonce, exp: expires })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  private verifyOAuthCsrfState(state: string, cookieState: string | undefined) {
    if (!state || !cookieState || state !== cookieState || !state.includes('.')) {
      throw new Error('Invalid OAuth state. Please try signing in again.');
    }
    const [payload, signature] = state.split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new Error('Invalid OAuth state signature.');
    }
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number };
    if (parsed.exp < Date.now()) {
      throw new Error('OAuth state expired. Please try signing in again.');
    }
  }
}
