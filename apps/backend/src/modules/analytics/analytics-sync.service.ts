import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Platform } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TokenRefreshService } from '../integration/token-refresh.service';
import { RealTimeAnalyticsService } from './real-time-analytics.service';
import { InstagramAnalyticsService } from './instagram-analytics.service';
import { FacebookAnalyticsService } from './facebook-analytics.service';
import { YouTubeAnalyticsService } from './youtube-analytics.service';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { MetaOAuthService } from '../integration/providers/meta-oauth.service';
import { YoutubeOAuthService } from '../integration/providers/youtube-oauth.service';

@Injectable()
export class AnalyticsSyncService {
  private readonly logger = new Logger(AnalyticsSyncService.name);
  private readonly active = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private tokenRefresh: TokenRefreshService,
    private realTime: RealTimeAnalyticsService,
    private instagram: InstagramAnalyticsService,
    private facebook: FacebookAnalyticsService,
    private youtube: YouTubeAnalyticsService,
    private snapshots: AnalyticsSnapshotService,
    private metaOAuth: MetaOAuthService,
    private youtubeOAuth: YoutubeOAuthService,
  ) {}

  @Cron(process.env.CRON_BASIC_STATS || '*/15 * * * *')
  async syncBasicStats() {
    await this.syncAll('basic_stats');
  }

  @Cron(process.env.CRON_POST_METRICS || '0 * * * *')
  async syncPostMetrics() {
    await this.syncAll('post_metrics');
  }

  @Cron(process.env.CRON_FULL_ANALYTICS || '0 2 * * *')
  async syncDailySummaries() {
    await this.syncAll('daily_summary');
  }

  async forceSyncOrg(organizationId: string) {
    return this.syncOrganization(organizationId, 'manual');
  }

  async syncAll(syncType: string) {
    const organizationIds = await this.prisma.integration.findMany({
      where: { deletedAt: null, disabled: false },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });

    for (const { organizationId } of organizationIds) {
      await this.syncOrganization(organizationId, syncType);
    }
  }

  async syncOrganization(organizationId: string, syncType: string) {
    const key = `${organizationId}:${syncType}`;
    if (this.active.has(key)) return { skipped: true, reason: 'sync_already_running' };
    this.active.add(key);

    try {
      const integrations = await this.prisma.integration.findMany({
        where: { organizationId, deletedAt: null, disabled: false },
      });
      const results: any[] = [];

      for (const integration of integrations) {
        results.push(await this.syncIntegration(integration, syncType));
      }

      await this.snapshots.recomputeSummaries(organizationId);
      return results;
    } finally {
      this.active.delete(key);
    }
  }

  private async syncIntegration(integration: any, syncType: string) {
    const startedAt = new Date();
    try {
      await this.refreshIfNeeded(integration);
      const fresh = await this.prisma.integration.findUnique({ where: { id: integration.id } });
      if (!fresh || fresh.disabled) return { integrationId: integration.id, skipped: true };
      const validation = this.validatePermissions(fresh);
      if (!validation.ok) {
        throw new Error(validation.message);
      }

      const realtime = await this.realTime.syncIntegration(fresh);
      const demographics = await this.syncDemographics(fresh);
      await this.snapshots.recomputeSummaries(fresh.organizationId, fresh.platform as Platform);
      await this.snapshots.logSync({
        organizationId: fresh.organizationId,
        integrationId: fresh.id,
        platform: fresh.platform,
        syncType,
        status: 'SUCCESS',
        startedAt,
        finishedAt: new Date(),
        itemsSynced: this.countItems(realtime) + this.countItems(demographics),
        apiResponse: { realtime, demographics },
      });
      return { integrationId: fresh.id, platform: fresh.platform, realtime, demographics };
    } catch (err: any) {
      const transient = this.isTransient(err);
      await this.snapshots.logSync({
        organizationId: integration.organizationId,
        integrationId: integration.id,
        platform: integration.platform,
        syncType,
        status: transient ? 'RETRYABLE_FAILURE' : 'FAILED',
        startedAt,
        finishedAt: new Date(),
        error: this.errorMessage(err),
        apiResponse: err?.response?.data,
      });
      this.logger.warn(`Analytics sync failed for ${integration.platform} ${integration.id}: ${this.errorMessage(err)}`);
      return { integrationId: integration.id, platform: integration.platform, error: this.errorMessage(err), retryable: transient };
    }
  }

  private async refreshIfNeeded(integration: any) {
    const expiresSoon = integration.tokenExpiry
      ? integration.tokenExpiry.getTime() < Date.now() + 24 * 60 * 60 * 1000
      : false;
    if (!integration.refreshNeeded && !expiresSoon) return;
    await this.tokenRefresh.refreshIntegrationToken(integration);
  }

  private async syncDemographics(integration: any) {
    if (integration.platform === 'INSTAGRAM') return this.instagram.syncDemographics(integration);
    if (integration.platform === 'FACEBOOK') return this.facebook.syncDemographics(integration);
    if (integration.platform === 'YOUTUBE') return this.youtube.syncDemographics(integration);
    return { skipped: true };
  }

  private validatePermissions(integration: any) {
    let profileData: any = {};
    try {
      profileData = integration.profileData ? JSON.parse(integration.profileData) : {};
    } catch {}

    if (integration.platform === 'YOUTUBE') {
      const missing = this.youtubeOAuth.getMissingScopes(profileData.grantedScopes || []);
      if (missing.length) {
        return {
          ok: false,
          message: `YouTube analytics scopes missing. Reconnect YouTube and grant: ${missing.join(', ')}`,
        };
      }
    }

    if (integration.platform === 'FACEBOOK' || integration.platform === 'INSTAGRAM') {
      const missing = this.metaOAuth.getMissingInsightPermissions(profileData.permissions || []);
      if (missing.length) {
        return {
          ok: false,
          message: `Meta insights permissions missing. Reconnect Meta and grant: ${missing.join(', ')}`,
        };
      }
      if (integration.platform === 'INSTAGRAM') {
        const accountType = String(profileData.accountType || profileData.account_type || '').toUpperCase();
        if (accountType && !['BUSINESS', 'CREATOR'].includes(accountType)) {
          return {
            ok: false,
            message: 'Instagram analytics require a Business or Creator account connected to a Facebook Page.',
          };
        }
      }
    }

    return { ok: true, message: '' };
  }

  private isTransient(err: any) {
    const status = Number(err?.response?.status || err?.code || 0);
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status)
      || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(err?.code);
  }

  private countItems(value: any) {
    if (!value || typeof value !== 'object') return 0;
    return (Object.values(value) as any[]).reduce((sum: number, item: any) => {
      if (Array.isArray(item)) return sum + item.length;
      if (typeof item === 'number') return sum + item;
      return sum;
    }, 0);
  }

  private errorMessage(err: any) {
    return err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || 'unknown error';
  }
}
