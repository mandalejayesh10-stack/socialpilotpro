import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MetaFetcherService } from './fetchers/meta-fetcher.service';
import { YoutubeFetcherService } from './fetchers/youtube-fetcher.service';
import { MetricsComputeService } from './compute/metrics-compute.service';
import { decrypt } from '../../common/utils/crypto.util';
import { Platform } from '@prisma/client';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private prisma: PrismaService,
    private metaFetcher: MetaFetcherService,
    private youtubeFetcher: YoutubeFetcherService,
    private metricsCompute: MetricsComputeService,
  ) {}

  // ── Tier 1: Basic stats ───────────────────────────────────
  async runBasicStats() {
    const integrations = await this.getActiveIntegrations();

    for (const integration of integrations) {
      try {
        const token = decrypt(integration.accessToken);
        const now = new Date();
        const periodStart = new Date(now.getTime() - 15 * 60 * 1000);

        if (integration.platform === 'INSTAGRAM' || integration.platform === 'FACEBOOK') {
          const data = await this.metaFetcher.fetchBasicStats(
            integration.platform,
            integration.internalId,
            token,
          );
          await this.storeRaw(integration, 'basic_stats', periodStart, now, data);
        }

        if (integration.platform === 'YOUTUBE') {
          const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;
          const data = await this.youtubeFetcher.fetchChannelStats(
            integration.internalId,
            token,
            refreshToken,
          );
          await this.storeRaw(integration, 'basic_stats', periodStart, now, data);
        }
      } catch (err) {
        this.logger.error(
          `Basic stats failed for integration ${integration.id}: ${err.message}`,
        );
        await this.storeSyncError(integration, 'basic_stats', err);
        await this.markRefreshNeeded(integration.id, err.message);
      }
    }
  }

  // ── Tier 2: Post metrics ──────────────────────────────────
  async runPostMetrics() {
    const integrations = await this.getActiveIntegrations();

    for (const integration of integrations) {
      try {
        const token = decrypt(integration.accessToken);
        const now = new Date();
        const periodStart = new Date(now.getTime() - 60 * 60 * 1000);

        // Get published posts from last 90 days
        const posts = await this.prisma.post.findMany({
          where: {
            integrationId: integration.id,
            state: 'PUBLISHED',
            publishDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
            deletedAt: null,
          },
          select: { id: true, externalId: true, publishDate: true },
        });

        if (posts.length === 0) continue;

        if (integration.platform === 'INSTAGRAM') {
          const metrics = await this.metaFetcher.fetchPostInsights(
            posts.filter((p) => p.externalId).map((p) => p.externalId!),
            token,
          );
          await this.storeRaw(integration, 'post_insights', periodStart, now, metrics);
          await this.metricsCompute.computePostMetrics(integration, posts, metrics);
        }

        if (integration.platform === 'FACEBOOK') {
          const metrics = await this.metaFetcher.fetchPagePostInsights(
            posts.filter((p) => p.externalId).map((p) => p.externalId!),
            token,
          );
          await this.storeRaw(integration, 'post_insights', periodStart, now, metrics);
          await this.metricsCompute.computePostMetrics(integration, posts, metrics);
        }

        if (integration.platform === 'YOUTUBE') {
          const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;
          const metrics = await this.youtubeFetcher.fetchVideoMetrics(
            posts.filter((p) => p.externalId).map((p) => p.externalId!),
            token,
            refreshToken,
          );
          await this.storeRaw(integration, 'video_metrics', periodStart, now, metrics);
          await this.metricsCompute.computePostMetrics(integration, posts, metrics);
        }
      } catch (err) {
        this.logger.error(
          `Post metrics failed for integration ${integration.id}: ${err.message}`,
        );
        await this.storeSyncError(integration, 'post_metrics', err);
      }
    }
  }

  // ── Tier 3: Full analytics aggregation ───────────────────
  async runFullAnalytics() {
    const integrations = await this.getActiveIntegrations();

    for (const integration of integrations) {
      try {
        const token = decrypt(integration.accessToken);
        const now = new Date();
        const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Fetch full insights
        if (integration.platform === 'INSTAGRAM') {
          const data = await this.metaFetcher.fetchInstagramInsights(
            integration.internalId,
            token,
          );
          await this.storeRaw(integration, 'page_insights', periodStart, now, data);
        }

        if (integration.platform === 'FACEBOOK') {
          const data = await this.metaFetcher.fetchPageInsights(
            integration.internalId,
            token,
          );
          await this.storeRaw(integration, 'page_insights', periodStart, now, data);
        }

        if (integration.platform === 'YOUTUBE') {
          const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;
          const data = await this.youtubeFetcher.fetchAnalytics(
            integration.internalId,
            token,
            refreshToken,
          );
          await this.storeRaw(integration, 'channel_analytics', periodStart, now, data);
        }

        // Compute account-level metrics
        await this.metricsCompute.computeAccountMetrics(integration);

        // Compute summary for 7d, 30d, 90d
        for (const period of ['7d', '30d', '90d']) {
          await this.metricsCompute.computeAnalyticsSummary(
            integration.organizationId,
            integration.platform,
            period,
          );
        }
      } catch (err) {
        this.logger.error(
          `Full analytics failed for integration ${integration.id}: ${err.message}`,
        );
        await this.storeSyncError(integration, 'full_analytics', err);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  private async getActiveIntegrations() {
    return this.prisma.integration.findMany({
      where: { deletedAt: null, disabled: false, refreshNeeded: false },
    });
  }

  private async storeRaw(
    integration: any,
    dataType: string,
    periodStart: Date,
    periodEnd: Date,
    rawData: any,
  ) {
    await this.prisma.analyticsRaw.create({
      data: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
        platform: integration.platform,
        dataType,
        periodStart,
        periodEnd,
        rawData: JSON.stringify(rawData),
      },
    });
  }

  private async markRefreshNeeded(integrationId: string, error: string) {
    if (error.includes('token') || error.includes('auth') || error.includes('401')) {
      await this.prisma.integration.update({
        where: { id: integrationId },
        data: { refreshNeeded: true },
      });
    }
  }

  private async storeSyncError(integration: any, jobType: string, err: any) {
    const now = new Date();
    try {
      await this.storeRaw(integration, 'sync_error', now, now, {
        jobType,
        message: err?.message || String(err),
        status: err?.response?.status || err?.code || null,
        at: now.toISOString(),
      });
    } catch (storeErr: any) {
      this.logger.warn(`Failed to store sync error for ${integration.id}: ${storeErr.message}`);
    }
  }
}
