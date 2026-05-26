import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import * as crypto from 'crypto';

/**
 * Retries only transient publish failures. Media validation, account permission,
 * local storage, and codec/dimension errors are intentionally not retried.
 */
@Injectable()
export class PostRetryService {
  private readonly logger = new Logger(PostRetryService.name);
  private readonly MAX_RETRIES = 3;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
  ) {}

  @Cron('*/15 * * * *')
  async retryFailedPosts() {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const failed = await this.prisma.post.findMany({
      where: {
        state: 'ERROR',
        deletedAt: null,
        updatedAt: { gte: twoHoursAgo },
        publishDate: { gte: oneDayAgo },
      },
      include: {
        integration: { select: { organizationId: true, platform: true } },
        publishLogs: {
          where: { status: 'FAILED' },
          orderBy: { createdAt: 'desc' },
        },
      },
      take: 20,
    });

    for (const post of failed) {
      const failedAttempts = post.publishLogs?.length || 0;
      const lastError = post.error || '';
      const isPermanent = this.isPermanentError(lastError);
      const isRetriable = this.isRetriableError(lastError);

      if (isPermanent || !isRetriable) {
        this.logger.warn(`[Retry] Post ${post.id} is not retryable - skipping retry: ${lastError.slice(0, 100)}`);
        await this.markTerminal(post.id, 'VALIDATION_FAILED', this.toFriendlyError(lastError));
        await this.notifyOnce(post.integration.organizationId, post.id, 'Post requires attention',
          `A ${post.integration.platform} post needs an account or media fix before it can publish. ${this.toFriendlyError(lastError)}`);
        await this.writeDeadLetter(post.id, post.integration.platform as any, lastError);
        continue;
      }

      if (failedAttempts >= this.MAX_RETRIES) {
        this.logger.warn(`[Retry] Post ${post.id} exceeded max retries (${this.MAX_RETRIES}) - giving up`);
        await this.markTerminal(post.id, 'RETRY_EXHAUSTED', lastError.slice(0, 500));
        await this.notifyOnce(post.integration.organizationId, post.id, 'Post failed permanently',
          `A ${post.integration.platform} post failed after ${this.MAX_RETRIES} attempts. Please check your account connection and reschedule.`);
        await this.writeDeadLetter(post.id, post.integration.platform as any, lastError);
        continue;
      }

      const backoffMinutes = Math.pow(2, failedAttempts) * 5;
      const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await this.prisma.post.update({
        where: { id: post.id },
        data: {
          state: 'QUEUE',
          publishDate: retryAt,
          error: `[retry:${failedAttempts + 1}/${this.MAX_RETRIES}] ${post.error?.replace(/\[retry:\d+\/\d+\] /, '') || ''}`,
        },
      });
      await this.prisma.$executeRawUnsafe(`UPDATE "Post" SET "retryCount" = COALESCE("retryCount", 0) + 1 WHERE id = $1`, post.id);

      try {
        await this.prisma.publishLog.create({
          data: {
            postId: post.id,
            platform: post.integration.platform as any,
            status: 'RETRYING',
            error: `Retry attempt ${failedAttempts + 1}/${this.MAX_RETRIES} scheduled for ${retryAt.toISOString()}`,
          },
        });
      } catch { /* ignore log failure */ }

      this.logger.log(`[Retry] Post ${post.id} - attempt ${failedAttempts + 1}/${this.MAX_RETRIES} at ${retryAt.toISOString()} (+${backoffMinutes}min)`);
    }
  }

  private isPermanentError(error: string): boolean {
    const permanent = [
      'API access blocked',
      'code 200',
      'quotaExceeded',
      'reconnect your',
      'Please reconnect',
      'Token refresh failed',
      'Instagram requires at least',
      'YouTube requires a video',
      'permanent public HTTPS',
      'local storage',
      'STORAGE_PROVIDER',
      'VALIDATION_FAILED',
      'unsupported codec',
      'unsupported file',
      'minimum resolution',
      'invalid dimensions',
      'invalid media',
      'invalid parameter',
      'code 100',
      'code 190',
      'missing permissions',
      'permission',
      'Authorization Error',
      'OAuthException',
    ];
    return permanent.some((p) => error.toLowerCase().includes(p.toLowerCase()));
  }

  private isRetriableError(error: string): boolean {
    const retriable = [
      '429',
      'rate limit',
      'too many requests',
      'timeout',
      'timed out',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'socket hang up',
      'temporarily unavailable',
      'try again later',
      'server error',
      '500',
      '502',
      '503',
      '504',
    ];
    return retriable.some((p) => error.toLowerCase().includes(p.toLowerCase()));
  }

  private toFriendlyError(error: string): string {
    const lower = error.toLowerCase();
    if (!error) return 'Please open the post details for more information.';
    if (lower.includes('local storage') || lower.includes('permanent public https')) {
      return 'Preparing secure cloud upload must complete before this post can publish.';
    }
    if (lower.includes('permission') || lower.includes('token')) {
      return 'Please reconnect the account and confirm the requested publishing permissions.';
    }
    if (lower.includes('invalid media') || lower.includes('codec') || lower.includes('resolution')) {
      return 'The media needs processing before this post can publish.';
    }
    return error.slice(0, 140);
  }

  private async notifyOnce(organizationId: string, postId: string, title: string, message: string) {
    const recent = await this.prisma.notification.findFirst({
      where: {
        organizationId,
        title,
        link: `/dashboard/calendar?post=${postId}`,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
    });
    if (recent) return;
    await this.notifications.create({
      organizationId,
      title,
      message,
      type: 'error',
      link: `/dashboard/calendar?post=${postId}`,
    });
  }

  private async writeDeadLetter(postId: string, platform: any, error: string) {
    try {
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO "PublishLog" ("id", "postId", "platform", "status", "error", "attempt", "createdAt")
        VALUES ($1, $2, $3::"Platform", 'DEAD_LETTERED'::"PublishLogStatus", $4, 1, NOW())
      `, crypto.randomUUID(), postId, platform, error.slice(0, 1000));
    } catch { /* ignore log failure */ }
  }

  private async markTerminal(postId: string, state: 'VALIDATION_FAILED' | 'RETRY_EXHAUSTED', reason: string) {
    await this.prisma.$executeRawUnsafe(`
      UPDATE "Post"
      SET state = $2::"State",
          "terminalReason" = $3,
          "claimToken" = NULL,
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "updatedAt" = NOW()
      WHERE id = $1
    `, postId, state, reason);
  }

  @Cron('0 3 * * *')
  async cleanupOldErrors() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.post.updateMany({
      where: {
        state: 'ERROR',
        updatedAt: { lt: thirtyDaysAgo },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.log(`[Cleanup] Archived ${result.count} old failed posts`);
    }
  }
}
