import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MetaOAuthService } from './providers/meta-oauth.service';
import { YoutubeOAuthService } from './providers/youtube-oauth.service';
import { InstagramOAuthService } from './providers/instagram-oauth.service';
import { LinkedinOAuthService } from './providers/linkedin-oauth.service';
import { ThreadsOAuthService } from './providers/threads-oauth.service';
import { GoogleBusinessOAuthService } from './providers/google-business-oauth.service';
import { encrypt, decrypt, safeDecrypt } from '../../common/utils/crypto.util';
import { Platform } from '@prisma/client';
import * as crypto from 'crypto';
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private prisma: PrismaService,
    private metaOAuth: MetaOAuthService,
    private youtubeOAuth: YoutubeOAuthService,
    private instagramOAuth: InstagramOAuthService,
    private linkedinOAuth: LinkedinOAuthService,
    private threadsOAuth: ThreadsOAuthService,
    private googleBusinessOAuth: GoogleBusinessOAuthService,
  ) {}

  // ── Get all integrations for an org ──────────────────────
  async getIntegrations(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    // Strip tokens from response
    return integrations.map((i) => this.sanitizeIntegration(i));
  }

  // ── Meta OAuth flow ───────────────────────────────────────
  async getMetaAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state = await this.createOAuthState(organizationId, userId, 'meta');
    return this.metaOAuth.getAuthUrl(state);
  }

  async handleMetaCallback(code: string, state: string) {
    const { organizationId } = await this.consumeOAuthState(state, 'meta');

    this.logger.log(`[Meta Callback] ===== START org=${organizationId} =====`);

    // 1. Exchange code for user token
    const { accessToken, userId, name, permissions } = await this.metaOAuth.exchangeCode(code);
    this.logger.log(`[Meta Callback] User token obtained for: ${name} (${userId})`);
    this.logger.log(`[Meta Callback] Granted permissions: ${permissions.join(', ')}`);

    // Warn if critical Instagram permissions are missing
    const missingIg = ['instagram_basic', 'pages_show_list']
      .filter(p => !permissions.includes(p));
    if (missingIg.length > 0) {
      this.logger.warn(`[Meta Callback] WARNING: Missing permissions: ${missingIg.join(', ')} — Instagram discovery may fail`);
    }

    // 2. Get pages (now includes instagram_business_account and connected_instagram_account)
    const pages = await this.metaOAuth.getPages(accessToken);
    this.logger.log(`[Meta Callback] Pages discovered: ${pages.length}`);

    const created: any[] = [];

    // 3. Save personal Facebook account
    const personalFb = await this.upsertIntegration({
      organizationId,
      platform: 'FACEBOOK',
      internalId: userId,
      name: name,
      accessToken: accessToken,
      profileData: JSON.stringify({ userId, type: 'personal', permissions }),
    });
    created.push(personalFb);
    this.logger.log(`[Meta Callback] [DB] Saved personal Facebook: id=${personalFb.id}, internalId=${userId}`);

    // 4. Process each Facebook Page
    for (const page of pages) {
      this.logger.log(
        `[Meta Callback] Processing page: "${page.name}" (${page.id}), ` +
        `hasToken=${!!page.accessToken}, ` +
        `igBizId=${(page as any).instagramBusinessAccountId || 'NONE'}, ` +
        `igConnId=${(page as any).connectedInstagramAccountId || 'NONE'}`,
      );

      // Save Facebook Page
      let fbIntegration: any;
      try {
        fbIntegration = await this.upsertIntegration({
          organizationId,
          platform: 'FACEBOOK',
          internalId: page.id,
          name: page.name,
          pictureUrl: page.pictureUrl,
          accessToken: page.accessToken,
          pageId: page.id,
          pageAccessToken: page.accessToken,
          profileData: JSON.stringify({ category: page.category, permissions }),
        });
        created.push(fbIntegration);
        this.logger.log(`[Meta Callback] [DB] Saved Facebook Page: id=${fbIntegration.id}, internalId=${page.id}`);
      } catch (err: any) {
        this.logger.error(`[Meta Callback] [DB ERROR] Failed to save Facebook page ${page.id}: ${err.message}`);
      }

      // 5. Discover Instagram account for this page
      this.logger.log(`[Meta Callback] Attempting Instagram discovery for page ${page.id}...`);
      let igAccount: any = null;
      try {
        igAccount = await this.metaOAuth.getInstagramAccount(
          page.id,
          page.accessToken,
          (page as any).instagramBusinessAccountId,
          (page as any).connectedInstagramAccountId,
        );
      } catch (err: any) {
        this.logger.error(`[Meta Callback] getInstagramAccount threw for page ${page.id}: ${err.message}`);
      }

      if (!igAccount) {
        this.logger.log(`[Meta Callback] No Instagram account found for page ${page.id} ("${page.name}") — skipping IG insert`);
        continue;
      }

      this.logger.log(
        `[Meta Callback] Instagram found: id=${igAccount.id}, username=${igAccount.username}, ` +
        `name="${igAccount.name}", followers=${igAccount.followersCount}, type=${igAccount.accountType}`,
      );

      // 6. Save Instagram integration
      try {
        const igIntegration = await this.upsertIntegration({
          organizationId,
          platform: 'INSTAGRAM',
          internalId: igAccount.id,
          name: igAccount.name || igAccount.username || `Instagram (${page.name})`,
          pictureUrl: igAccount.pictureUrl,
          accessToken: page.accessToken,
          pageId: page.id,
          pageAccessToken: page.accessToken,
          profileData: JSON.stringify({
            username: igAccount.username,
            followersCount: igAccount.followersCount,
            accountType: igAccount.accountType,
            linkedPageId: page.id,
            linkedPageName: page.name,
            permissions,
          }),
        });
        created.push(igIntegration);
        this.logger.log(
          `[Meta Callback] [DB] Saved Instagram: id=${igIntegration.id}, internalId=${igAccount.id}, username=${igAccount.username}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[Meta Callback] [DB ERROR] Failed to save Instagram account ${igAccount.id} (${igAccount.username}): ${err.message}\n${err.stack}`,
        );
      }
    }

    // 7. Summary
    const fbCount = created.filter(i => i.platform === 'FACEBOOK').length;
    const igCount = created.filter(i => i.platform === 'INSTAGRAM').length;
    this.logger.log(
      `[Meta Callback] ===== COMPLETE: ${created.length} integrations saved — FB=${fbCount}, IG=${igCount} =====`,
    );

    if (igCount === 0 && pages.length > 0) {
      this.logger.warn(
        `[Meta Callback] WARNING: ${pages.length} Facebook page(s) found but 0 Instagram accounts discovered. ` +
        `Check: 1) Is Instagram connected to the page in Facebook Business Settings? ` +
        `2) Is the Facebook App in instagram_basic scope? ` +
        `3) Check logs above for raw API responses.`,
      );
    }

    await this.updateAccountCount(organizationId);
    return created.map((i) => this.sanitizeIntegration(i));
  }

  // ── Instagram Direct OAuth flow ───────────────────────────
  async getInstagramAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state = await this.createOAuthState(organizationId, userId, 'instagram');
    return this.instagramOAuth.getAuthUrl(state);
  }

  async handleInstagramCallback(code: string, state: string) {
    const { organizationId } = await this.consumeOAuthState(state, 'instagram');

    this.logger.log(`[Instagram Direct Callback] ===== START org=${organizationId} =====`);

    const data = await this.instagramOAuth.exchangeCode(code);

    const expiryDate = new Date(Date.now() + (data.expiresIn || 5183999) * 1000);

    const integration = await this.upsertIntegration({
      organizationId,
      platform: 'INSTAGRAM',
      internalId: data.userId,
      name: data.username,
      accessToken: data.accessToken,
      tokenExpiry: expiryDate,
      profileData: JSON.stringify({
        username: data.username,
        accountType: data.accountType,
        mediaCount: data.mediaCount,
        connectionType: 'direct_instagram',
      }),
    });

    this.logger.log(
      `[Instagram Direct Callback] [DB] Saved Direct Instagram Account: id=${integration.id}, internalId=${data.userId}, username=${data.username}`,
    );

    await this.updateAccountCount(organizationId);

    return this.sanitizeIntegration(integration);
  }

  // ── YouTube OAuth flow ────────────────────────────────────
  async getYoutubeAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state = await this.createOAuthState(organizationId, userId, 'youtube');
    return this.youtubeOAuth.getAuthUrl(state);
  }

  async handleYoutubeCallback(code: string, state: string) {
    const { organizationId } = await this.consumeOAuthState(state, 'youtube');

    const data = await this.youtubeOAuth.exchangeCode(code);

    const integration = await this.upsertIntegration({
      organizationId,
      platform: 'YOUTUBE',
      internalId: data.channelId,
      name: data.channelName,
      pictureUrl: data.pictureUrl,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiry: data.expiryDate,
      profileData: JSON.stringify({
        subscriberCount: data.subscriberCount,
        grantedScopes: data.grantedScopes,
      }),
    });

    await this.updateAccountCount(organizationId);

    return this.sanitizeIntegration(integration);
  }

  // ── LinkedIn OAuth flow ───────────────────────────────────
  async getLinkedinAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state = await this.createOAuthState(organizationId, userId, 'linkedin');
    return this.linkedinOAuth.getAuthUrl(state);
  }

  async handleLinkedinCallback(code: string, state: string) {
    const { organizationId } = await this.consumeOAuthState(state, 'linkedin');
    const data = await this.linkedinOAuth.exchangeCode(code);

    const expiryDate = data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : undefined;

    const integration = await this.upsertIntegration({
      organizationId,
      platform: 'LINKEDIN',
      internalId: data.profileId,
      name: data.profileName,
      pictureUrl: data.pictureUrl,
      accessToken: data.accessToken,
      tokenExpiry: expiryDate,
      profileData: JSON.stringify({
        email: data.email,
      }),
    });

    await this.updateAccountCount(organizationId);
    return this.sanitizeIntegration(integration);
  }

  // ── Threads OAuth flow ────────────────────────────────────
  async getThreadsAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state = await this.createOAuthState(organizationId, userId, 'threads');
    return this.threadsOAuth.getAuthUrl(state);
  }

  async handleThreadsCallback(code: string, state: string) {
    const { organizationId } = await this.consumeOAuthState(state, 'threads');
    const data = await this.threadsOAuth.exchangeCode(code);

    const expiryDate = data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : undefined;

    const integration = await this.upsertIntegration({
      organizationId,
      platform: 'THREADS',
      internalId: data.profileId,
      name: data.profileName,
      pictureUrl: data.pictureUrl,
      accessToken: data.accessToken,
      tokenExpiry: expiryDate,
    });

    await this.updateAccountCount(organizationId);
    return this.sanitizeIntegration(integration);
  }

  // ── Google Business OAuth flow ────────────────────────────
  async getGoogleBusinessAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state = await this.createOAuthState(organizationId, userId, 'google-business');
    return this.googleBusinessOAuth.getAuthUrl(state);
  }

  async handleGoogleBusinessCallback(code: string, state: string) {
    const { organizationId } = await this.consumeOAuthState(state, 'google-business');
    const data = await this.googleBusinessOAuth.exchangeCode(code);

    const integration = await this.upsertIntegration({
      organizationId,
      platform: 'GOOGLE_BUSINESS',
      internalId: data.profileId,
      name: data.profileName,
      pictureUrl: data.pictureUrl,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiry: data.expiryDate,
    });

    await this.updateAccountCount(organizationId);
    return this.sanitizeIntegration(integration);
  }

  // ── Disconnect integration ────────────────────────────────
  async disconnect(organizationId: string, integrationId: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, organizationId, deletedAt: null },
    });
    if (!integration) throw new NotFoundException('Integration not found');

    await this.prisma.integration.update({
      where: { id: integrationId },
      data: { deletedAt: new Date() },
    });

    await this.updateAccountCount(organizationId);
    return { message: 'Integration disconnected' };
  }

  // ── Get decrypted token (internal use only) ───────────────
  async getDecryptedToken(integrationId: string): Promise<string | null> {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });
    if (!integration) return null;
    return safeDecrypt(integration.accessToken);
  }

  // ── Private helpers ───────────────────────────────────────
  private async upsertIntegration(data: {
    organizationId: string;
    platform: string;
    internalId: string;
    name: string;
    pictureUrl?: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry?: Date;
    pageId?: string;
    pageAccessToken?: string;
    profileData?: string;
  }) {
    const encryptedToken = encrypt(data.accessToken);
    const encryptedRefresh = data.refreshToken ? encrypt(data.refreshToken) : null;
    const encryptedPageToken = data.pageAccessToken ? encrypt(data.pageAccessToken) : null;

    return this.prisma.integration.upsert({
      where: {
        organizationId_platform_internalId: {
          organizationId: data.organizationId,
          platform: data.platform as Platform,
          internalId: data.internalId,
        },
      },
      create: {
        organizationId: data.organizationId,
        platform: data.platform as Platform,
        internalId: data.internalId,
        name: data.name,
        pictureUrl: data.pictureUrl,
        accessToken: encryptedToken,
        refreshToken: encryptedRefresh,
        tokenExpiry: data.tokenExpiry,
        pageId: data.pageId,
        pageAccessToken: encryptedPageToken,
        profileData: data.profileData,
        refreshNeeded: false,
        disabled: false,
      },
      update: {
        name: data.name,
        pictureUrl: data.pictureUrl,
        accessToken: encryptedToken,
        refreshToken: encryptedRefresh,
        tokenExpiry: data.tokenExpiry,
        pageAccessToken: encryptedPageToken,
        profileData: data.profileData,
        refreshNeeded: false,
        disabled: false,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  private async createOAuthState(organizationId: string, userId: string, platform: string): Promise<string> {
    const nonce = crypto.randomBytes(24).toString('base64url');
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const payload = { nonce, organizationId, userId, platform, exp: expiresAt.getTime() };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.signState(encodedPayload);

    await this.prisma.$executeRawUnsafe(`
      INSERT INTO "OAuthState" ("id", "nonce", "organizationId", "userId", "platform", "signature", "expiresAt", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, id, nonce, organizationId, userId, platform, signature, expiresAt);

    return `${encodedPayload}.${signature}`;
  }

  private async consumeOAuthState(state: string, platform: string): Promise<{ organizationId: string; userId: string }> {
    if (!state || !state.includes('.')) throw new BadRequestException('Invalid OAuth state');
    const [encodedPayload, signature] = state.split('.');
    const expected = this.signState(encodedPayload);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new BadRequestException('Invalid OAuth state signature');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as {
      nonce: string;
      organizationId: string;
      userId: string;
      platform: string;
      exp: number;
    };
    if (payload.platform !== platform || payload.exp < Date.now()) {
      throw new BadRequestException('Expired or mismatched OAuth state');
    }

    const stateRows = await this.prisma.$queryRawUnsafe<Array<{ consumedAt: Date | null; expiresAt: Date }>>(`
      SELECT "consumedAt", "expiresAt" FROM "OAuthState" WHERE nonce = $1 LIMIT 1
    `, payload.nonce);
    const stateRow = stateRows[0];
    if (!stateRow || stateRow.consumedAt || stateRow.expiresAt < new Date()) {
      throw new BadRequestException('OAuth state was already used or expired');
    }

    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId: payload.userId, organizationId: payload.organizationId } },
    });
    if (!membership || membership.disabled) throw new BadRequestException('OAuth state is not valid for this organization');

    const consumed = await this.prisma.$executeRawUnsafe(`
      UPDATE "OAuthState"
      SET "consumedAt" = NOW()
      WHERE nonce = $1 AND "consumedAt" IS NULL
    `, payload.nonce);
    if (Number(consumed) !== 1) throw new BadRequestException('OAuth state was already used');

    return { organizationId: payload.organizationId, userId: payload.userId };
  }

  private signState(encodedPayload: string): string {
    return crypto
      .createHmac('sha256', process.env.JWT_SECRET || process.env.TOKEN_ENCRYPTION_KEY || 'dev-only')
      .update(encodedPayload)
      .digest('base64url');
  }

  private async updateAccountCount(organizationId: string) {
    const count = await this.prisma.integration.count({
      where: { organizationId, deletedAt: null },
    });
    await this.prisma.usageLimits.upsert({
      where: { organizationId },
      create: { organizationId, accountsConnected: count },
      update: { accountsConnected: count },
    });
  }

  private sanitizeIntegration(integration: any) {
    const { accessToken, refreshToken, pageAccessToken, ...safe } = integration;
    return safe;
  }
}
