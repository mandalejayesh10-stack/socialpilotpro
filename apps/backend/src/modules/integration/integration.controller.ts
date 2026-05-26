import {
  Controller, Get, Delete, Query, Param, Res, UseGuards, Headers, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { IntegrationService } from './integration.service';
import { MetaOAuthService } from './providers/meta-oauth.service';
import { YoutubeOAuthService } from './providers/youtube-oauth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentOrg, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationController {
  constructor(
    private integrationService: IntegrationService,
    private metaOAuth: MetaOAuthService,
    private youtubeOAuth: YoutubeOAuthService,
  ) {}

  // ── List integrations ─────────────────────────────────────
  @Get()
  @UseGuards(OrgMemberGuard)
  @ApiOperation({ summary: 'List all connected social accounts' })
  async getIntegrations(@CurrentOrg() org: any) {
    return this.integrationService.getIntegrations(org.id);
  }

  // ── OAuth status ──────────────────────────────────────────
  @Get('status')
  @Public()
  @ApiOperation({ summary: 'Check which OAuth providers are configured' })
  getStatus() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
    return {
      meta: {
        configured: this.metaOAuth.isConfigured(),
        feature: 'Instagram + Facebook',
        account: 'bamandlajayesh@gmail.com',
        appId: process.env.FACEBOOK_APP_ID,
        addRedirectUri: `${backendUrl}/api/integrations/meta/callback`,
      },
      youtube: {
        configured: this.youtubeOAuth.isConfigured(),
        feature: 'YouTube',
        account: 'mandalejayesh10@gmail.com',
        addRedirectUri: `${backendUrl}/api/integrations/youtube/callback`,
      },
    };
  }

  // ── Meta OAuth ────────────────────────────────────────────
  @Get('meta/connect')
  @UseGuards(OrgMemberGuard, PermissionsGuard)
  @RequirePermissions('integrations:write')
  @ApiOperation({ summary: 'Start Meta OAuth flow' })
  async connectMeta(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query('x-org-id') orgId: string,
    @Query('orgId') orgId2: string,
    @Res() res: Response,
  ) {
    const organizationId = org?.id || orgId || orgId2;
    if (!this.metaOAuth.isConfigured()) {
      return res.status(503).send(this.buildConfigErrorPage(
        'Meta (Facebook + Instagram)',
        'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET',
        'SETUP_META.md',
        process.env.FRONTEND_URL || 'http://localhost:4200',
      ));
    }
    const url = await this.integrationService.getMetaAuthUrl(organizationId, user.id);
    res.redirect(url);
  }

  @Public()
  @Get('meta/callback')
  @ApiOperation({ summary: 'Meta OAuth callback' })
  async metaCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      if (!code) {
        throw new Error('No authorization code received from Meta');
      }
      const result = await this.integrationService.handleMetaCallback(code, state);
      const count = Array.isArray(result) ? result.length : 1;
      res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings/connections?connected=meta&count=${count}`);
    } catch (err: any) {
      console.error('[Meta Callback Error]', err.message, err.stack);
      res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings/connections?error=${encodeURIComponent(err.message)}`);
    }
  }

  // ── YouTube OAuth ─────────────────────────────────────────
  @Get('youtube/connect')
  @UseGuards(OrgMemberGuard, PermissionsGuard)
  @RequirePermissions('integrations:write')
  @ApiOperation({ summary: 'Start YouTube OAuth flow' })
  async connectYoutube(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query('x-org-id') orgId: string,
    @Query('orgId') orgId2: string,
    @Res() res: Response,
  ) {
    const organizationId = org?.id || orgId || orgId2;
    if (!this.youtubeOAuth.isConfigured()) {
      return res.status(503).send(this.buildConfigErrorPage(
        'YouTube',
        'YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET',
        'SETUP_OAUTH.md',
        process.env.FRONTEND_URL || 'http://localhost:4200',
      ));
    }
    const url = await this.integrationService.getYoutubeAuthUrl(organizationId, user.id);
    res.redirect(url);
  }

  @Public()
  @Get('youtube/callback')
  @ApiOperation({ summary: 'YouTube OAuth callback' })
  async youtubeCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.integrationService.handleYoutubeCallback(code, state);
      res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings/connections?connected=youtube`);
    } catch (err: any) {
      res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings/connections?error=${encodeURIComponent(err.message)}`);
    }
  }

  // ── Disconnect ────────────────────────────────────────────
  @Delete(':id')
  @UseGuards(OrgMemberGuard, PermissionsGuard)
  @RequirePermissions('integrations:write')
  @ApiOperation({ summary: 'Disconnect a social account' })
  async disconnect(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.integrationService.disconnect(org.id, id);
  }

  // ── Helper: config error HTML page ───────────────────────
  private buildConfigErrorPage(
    service: string,
    envVars: string,
    guide: string,
    frontendUrl: string,
  ): string {
    return `<!DOCTYPE html>
<html>
<head><title>${service} Not Configured</title>
<style>
  body { font-family: system-ui; background: #0f0f1a; color: #f0f0ff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #16162a; border: 1px solid #2a2a45; border-radius: 16px; padding: 40px; max-width: 520px; }
  h1 { color: #f59e0b; margin-top: 0; font-size: 20px; }
  code { background: #1a1a30; padding: 2px 8px; border-radius: 4px; font-family: monospace; color: #818cf8; }
  .step { margin: 8px 0; padding: 8px 12px; background: #1a1a30; border-radius: 8px; font-size: 14px; line-height: 1.6; }
  a { color: #818cf8; }
  .back { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 10px; text-decoration: none; font-size: 14px; }
</style>
</head>
<body>
  <div class="card">
    <h1>⚠️ ${service} Not Configured</h1>
    <p style="color:#9898b8">The required API credentials are missing from your <code>.env</code> file.</p>
    <div class="step"><strong>Missing:</strong> <code>${envVars}</code></div>
    <div class="step">
      1. Add the credentials to your <code>.env</code> file<br>
      2. Restart the backend server<br>
      3. See <code>${guide}</code> for step-by-step instructions
    </div>
    <a href="${frontendUrl}/dashboard/settings/connections" class="back">← Back to Connections</a>
  </div>
</body>
</html>`;
  }
}
