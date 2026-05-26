import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MetaOAuthService } from './providers/meta-oauth.service';
import { YoutubeOAuthService } from './providers/youtube-oauth.service';
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

    this.logger.log(`[Meta Callback] org=${organizationId} code=${code.slice(0,10)}...`);

    // Exchange code for user token
    const { accessToken, userId, name, permissions } = await this.metaOAuth.exchangeCode(code);
    this.logger.log(`[Meta Callback] Got user token for: ${name} (${userId})`);

    // Get pages
    const pages = await this.metaOAuth.getPages(accessToken);
    this.logger.log(`[Meta Callback] Found ${pages.length} Facebook pages`);

    const created: any[] = [];

    // Always save the personal Facebook account first
    const personalFb = await this.upsertIntegration({
      organizationId,
      platform: 'FACEBOOK',
      internalId: userId,
      name: name,
      accessToken: accessToken,
      profileData: JSON.stringify({ userId, type: 'personal', permissions }),
    });
    created.push(personalFb);
    this.logger.log(`[Meta Callback] Saved personal Facebook account: ${name}`);

    for (const page of pages) {
      this.logger.log(`[Meta Callback] Processing page: ${page.name} (${page.id})`);

      // Save Facebook Page integration (overrides personal if same ID)
      const fbIntegration = await this.upsertIntegration({
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

      // Check for linked Instagram account
      const igAccount = await this.metaOAuth.getInstagramAccount(page.id, page.accessToken);
      if (igAccount) {
        this.logger.log(`[Meta Callback] Found Instagram: ${igAccount.username}`);
        const igIntegration = await this.upsertIntegration({
          organizationId,
          platform: 'INSTAGRAM',
          internalId: igAccount.id,
          name: igAccount.name || igAccount.username,
          pictureUrl: igAccount.pictureUrl,
          accessToken: page.accessToken,
          pageId: page.id,
          pageAccessToken: page.accessToken,
          profileData: JSON.stringify({
            username: igAccount.username,
            followersCount: igAccount.followersCount,
            accountType: igAccount.accountType,
            permissions,
          }),
        });
        created.push(igIntegration);
      }
    }

    // Update usage limits
    await this.updateAccountCount(organizationId);

    this.logger.log(`[Meta Callback] Saved ${created.length} integrations`);
    return created.map((i) => this.sanitizeIntegration(i));
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
