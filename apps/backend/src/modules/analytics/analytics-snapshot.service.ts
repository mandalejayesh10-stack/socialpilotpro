import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Platform } from '@prisma/client';

type TimelinePoint = { date: string; value: number };

@Injectable()
export class AnalyticsSnapshotService {
  private readonly logger = new Logger(AnalyticsSnapshotService.name);

  constructor(private prisma: PrismaService) {}

  async recomputeSummaries(organizationId: string, platform?: Platform) {
    const platforms: Platform[] = platform ? [platform] : ['INSTAGRAM', 'FACEBOOK', 'YOUTUBE'];
    for (const p of platforms) {
      for (const period of ['7d', '30d', '90d']) {
        await this.recomputeSummary(organizationId, p, period);
      }
    }
  }

  async recomputeSummary(organizationId: string, platform: Platform, period: string) {
    const days = this.periodDays(period);
    const since = this.startOfDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));

    const metrics = await this.prisma.accountMetrics.findMany({
      where: { organizationId, platform, periodDate: { gte: since } },
      orderBy: [{ periodDate: 'asc' }, { integrationId: 'asc' }],
    });

    if (metrics.length === 0) return null;

    const byDate = new Map<string, any[]>();
    for (const metric of metrics) {
      const key = this.dateKey(metric.periodDate);
      const rows = byDate.get(key) || [];
      rows.push(metric);
      byDate.set(key, rows);
    }

    const dates = this.dateRange(days);
    let lastFollowers = 0;
    const followerTimeline: TimelinePoint[] = [];
    const engagementTimeline: TimelinePoint[] = [];
    const reachTimeline: TimelinePoint[] = [];
    const impressionTimeline: TimelinePoint[] = [];

    for (const date of dates) {
      const rows = byDate.get(date) || [];
      const followers = this.sum(rows, platform === 'YOUTUBE' ? 'subscribers' : 'followers');
      if (followers > 0) lastFollowers = followers;
      followerTimeline.push({ date, value: lastFollowers });
      reachTimeline.push({ date, value: this.sum(rows, platform === 'YOUTUBE' ? 'totalViews' : 'totalReach') });
      impressionTimeline.push({ date, value: this.sum(rows, 'totalImpressions') });
      engagementTimeline.push({ date, value: this.average(rows.map((row) => this.safe(row.avgEngagementRate))) });
    }

    const nonZeroFollowers = followerTimeline.filter((point) => point.value > 0);
    const firstFollowers = nonZeroFollowers[0]?.value || followerTimeline[0]?.value || 0;
    const totalFollowers = followerTimeline[followerTimeline.length - 1]?.value || 0;
    const followerGrowth = totalFollowers - firstFollowers;
    const growthPercent = firstFollowers > 0 ? (followerGrowth / firstFollowers) * 100 : 0;
    const latestRows = byDate.get(dates[dates.length - 1]) || metrics.slice(-1);

    const totalLikes = this.sum(metrics, 'totalLikes');
    const totalComments = this.sum(metrics, 'totalComments');
    const totalShares = this.sum(metrics, 'totalShares');
    const totalReach = reachTimeline.reduce((sum, point) => sum + point.value, 0);
    const totalImpressions = impressionTimeline.reduce((sum, point) => sum + point.value, 0);
    const avgEngagementRate = totalReach > 0
      ? ((totalLikes + totalComments + totalShares) / totalReach) * 100
      : this.average(metrics.map((row) => this.safe(row.avgEngagementRate)));

    return this.prisma.analyticsSummary.upsert({
      where: { organizationId_platform_periodType: { organizationId, platform, periodType: period } },
      create: {
        organizationId,
        platform,
        periodType: period,
        totalFollowers,
        followerGrowth,
        growthPercent: this.round(growthPercent),
        avgEngagementRate: this.round(avgEngagementRate),
        totalPosts: this.sum(latestRows, 'totalPosts'),
        totalReach,
        totalImpressions,
        followerTimeline: JSON.stringify(followerTimeline),
        engagementTimeline: JSON.stringify(engagementTimeline),
        reachTimeline: JSON.stringify(reachTimeline),
      },
      update: {
        totalFollowers,
        followerGrowth,
        growthPercent: this.round(growthPercent),
        avgEngagementRate: this.round(avgEngagementRate),
        totalPosts: this.sum(latestRows, 'totalPosts'),
        totalReach,
        totalImpressions,
        followerTimeline: JSON.stringify(followerTimeline),
        engagementTimeline: JSON.stringify(engagementTimeline),
        reachTimeline: JSON.stringify(reachTimeline),
        computedAt: new Date(),
      },
    });
  }

  async storeDemographics(input: {
    organizationId: string;
    integrationId: string;
    platform: Platform;
    country?: any;
    city?: any;
    age?: any;
    gender?: any;
    language?: any;
    activeHours?: any;
    returningVsNew?: any;
    source?: string;
  }) {
    const periodDate = this.startOfDay(new Date());
    const serialize = (value: any) => JSON.stringify(value || {});
    return (this.prisma as any).audienceDemographics.upsert({
      where: { integrationId_periodDate: { integrationId: input.integrationId, periodDate } },
      create: {
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        platform: input.platform,
        periodDate,
        country: serialize(input.country),
        city: serialize(input.city),
        age: serialize(input.age),
        gender: serialize(input.gender),
        language: serialize(input.language),
        activeHours: serialize(input.activeHours),
        returningVsNew: serialize(input.returningVsNew),
        source: input.source || 'api',
      },
      update: {
        country: serialize(input.country),
        city: serialize(input.city),
        age: serialize(input.age),
        gender: serialize(input.gender),
        language: serialize(input.language),
        activeHours: serialize(input.activeHours),
        returningVsNew: serialize(input.returningVsNew),
        source: input.source || 'api',
        syncedAt: new Date(),
      },
    });
  }

  async logSync(input: {
    organizationId: string;
    integrationId?: string | null;
    platform?: Platform | null;
    syncType: string;
    status: string;
    startedAt?: Date;
    finishedAt?: Date;
    itemsSynced?: number;
    error?: string | null;
    apiResponse?: any;
  }) {
    try {
      return (this.prisma as any).syncLog.create({
        data: {
          organizationId: input.organizationId,
          integrationId: input.integrationId || null,
          platform: input.platform || null,
          syncType: input.syncType,
          status: input.status,
          startedAt: input.startedAt || new Date(),
          finishedAt: input.finishedAt || new Date(),
          itemsSynced: input.itemsSynced || 0,
          error: input.error || null,
          apiResponse: input.apiResponse ? JSON.stringify(input.apiResponse).slice(0, 20000) : null,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Unable to write analytics sync log: ${err.message}`);
      return null;
    }
  }

  normalizeBreakdown(raw: any) {
    const obj = typeof raw === 'string' ? this.parseJson(raw, {}) : raw || {};
    const entries = Array.isArray(obj)
      ? obj.map((item: any) => [item.label || item.name || item.key, item.value ?? item.count ?? item.percent])
      : Object.entries(obj);
    const total = entries.reduce((sum, [, value]) => sum + this.safe(value), 0);
    return entries
      .map(([label, value]) => ({
        label: String(label || 'Unknown'),
        value: this.safe(value),
        percent: total > 0 ? this.round((this.safe(value) / total) * 100) : this.safe(value),
      }))
      .filter((item) => item.label && item.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  parseJson(value: string | null | undefined, fallback: any) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  periodDays(period: string) {
    return period === '7d' ? 7 : period === '90d' ? 90 : 30;
  }

  dateRange(days: number) {
    return Array.from({ length: days }, (_, index) => {
      const date = this.startOfDay(new Date(Date.now() - (days - 1 - index) * 24 * 60 * 60 * 1000));
      return this.dateKey(date);
    });
  }

  dateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  startOfDay(date: Date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private sum(rows: any[], key: string) {
    return rows.reduce((sum, row) => sum + this.safe(row?.[key]), 0);
  }

  private average(values: number[]) {
    const clean = values.filter((value) => Number.isFinite(value));
    return clean.length ? this.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
  }

  private safe(value: any) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  private round(value: number) {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  }
}
