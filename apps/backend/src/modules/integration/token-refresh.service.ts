import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { MetaOAuthService } from './providers/meta-oauth.service';
import { YoutubeOAuthService } from './providers/youtube-oauth.service';
import { encrypt, decrypt, safeDecrypt } from '../../common/utils/crypto.util';

@Injectable()
export class TokenRefreshService {
  private readonly logger = new Logger(TokenRefreshService.name);

  constructor(
    private prisma: PrismaService,
    private metaOAuth: MetaOAuthService,
    private youtubeOAuth: YoutubeOAuthService,
  ) {}

  /**
   * Runs every 6 hours — refreshes tokens expiring within 7 days.
   */
  @Cron('0 */6 * * *')
  async refreshExpiringTokens() {
    this.logger.log('Running token refresh check...');

    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const expiring = await this.prisma.integration.findMany({
      where: {
        deletedAt: null,
        disabled: false,
        OR: [
          { tokenExpiry: { lte: sevenDaysFromNow } },
          { refreshNeeded: true },
        ],
      },
    });

    this.logger.log(`Found ${expiring.length} integrations needing token refresh`);

    for (const integration of expiring) {
      try {
        await this.refreshIntegrationToken(integration);
      } catch (err) {
        this.logger.error(`Failed to refresh token for ${integration.id}: ${err.message}`);
        await this.prisma.integration.update({
          where: { id: integration.id },
          data: { refreshNeeded: true },
        });
      }
    }
  }

  async refreshIntegrationToken(integration: any) {
    if (integration.platform === 'YOUTUBE') {
      if (!integration.refreshToken) {
        await this.prisma.integration.update({
          where: { id: integration.id },
          data: { refreshNeeded: true, disabled: true },
        });
        return;
      }

      const decryptedRefresh = safeDecrypt(integration.refreshToken);
      if (!decryptedRefresh) {
        this.logger.error(`[TokenRefresh] Failed to decrypt refresh token for integration ${integration.id}`);
        return;
      }
      const { accessToken, expiryDate } = await this.youtubeOAuth.refreshToken(decryptedRefresh);

      await this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          accessToken: encrypt(accessToken),
          tokenExpiry: expiryDate,
          refreshNeeded: false,
        },
      });

      this.logger.log(`Refreshed YouTube token for integration ${integration.id}`);
    }

    if (integration.platform === 'FACEBOOK' || integration.platform === 'INSTAGRAM') {
      const decryptedToken = safeDecrypt(integration.accessToken);
      if (!decryptedToken) {
        this.logger.error(`[TokenRefresh] Failed to decrypt access token for Meta integration ${integration.id}`);
        return;
      }
      const { accessToken, expiresIn } = await this.metaOAuth.refreshToken(decryptedToken);

      const expiry = new Date(Date.now() + expiresIn * 1000);

      await this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          accessToken: encrypt(accessToken),
          tokenExpiry: expiry,
          refreshNeeded: false,
        },
      });

      this.logger.log(`Refreshed Meta token for integration ${integration.id}`);
    }
  }
}
