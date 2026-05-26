import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AiService } from '../ai/ai.service';
import { PdfService } from './pdf.service';
import { EmailService } from '../notification/email.service';
import { Platform } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private prisma: PrismaService,
    private analytics: AnalyticsService,
    private ai: AiService,
    private pdf: PdfService,
    private email: EmailService,
  ) {}

  async createReport(params: {
    organizationId: string;
    title: string;
    platform?: Platform;
    periodStart: Date;
    periodEnd: Date;
    emailTo?: string;
  }) {
    const report = await this.prisma.report.create({
      data: {
        organizationId: params.organizationId,
        title: params.title,
        platform: params.platform,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        status: 'PENDING',
        emailTo: params.emailTo,
      },
    });

    // Generate asynchronously
    this.generateReport(report.id).catch((err) =>
      this.logger.error(`Report generation failed: ${err.message}`),
    );

    return report;
  }

  async generateReport(reportId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');

    await this.prisma.report.update({ where: { id: reportId }, data: { status: 'GENERATING' } });

    try {
      const platform = report.platform || 'INSTAGRAM';
      const days = Math.ceil(
        (report.periodEnd.getTime() - report.periodStart.getTime()) / (1000 * 60 * 60 * 24),
      );
      const period = days <= 7 ? '7d' : days <= 30 ? '30d' : '90d';

      const [analytics, topPosts] = await Promise.all([
        this.analytics.getPlatformAnalytics(report.organizationId, platform as Platform, period),
        this.analytics.getTopPosts(report.organizationId, platform as Platform, days, 10),
      ]);

      const metrics = analytics.summary
        ? {
            total_followers: analytics.summary.totalFollowers,
            follower_growth: analytics.summary.followerGrowth,
            growth_percent: `${analytics.summary.growthPercent}%`,
            avg_engagement_rate: `${analytics.summary.avgEngagementRate.toFixed(2)}%`,
            total_reach: analytics.summary.totalReach,
            total_posts: analytics.summary.totalPosts,
          }
        : {};

      const aiInsights = await this.ai.generateReportSummary({
        platform,
        period,
        metrics,
        topPosts,
      });

      const html = this.pdf.buildReportHtml({
        title: report.title,
        period: `${report.periodStart.toLocaleDateString()} - ${report.periodEnd.toLocaleDateString()}`,
        platform,
        metrics,
        topPosts,
        aiInsights,
      });

      const filename = `report_${reportId}_${uuidv4().slice(0, 8)}`;
      const pdfPath = await this.pdf.generateReport(html, filename);
      const pdfUrl = `/api/reports/${reportId}/download`;

      await this.prisma.report.update({
        where: { id: reportId },
        data: {
          status: 'READY',
          pdfUrl,
          aiInsights,
        },
      });

      // Send email if requested
      if (report.emailTo) {
        await this.email.sendReport(report.emailTo, report.title, pdfUrl);
      }

      return { pdfUrl, aiInsights };
    } catch (err) {
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  async getReports(organizationId: string) {
    return this.prisma.report.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReport(organizationId: string, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async getReportFile(organizationId: string, reportId: string) {
    const report = await this.getReport(organizationId, reportId);
    const filename = report.pdfUrl?.startsWith('/api/reports/')
      ? `report_${reportId}_`
      : path.basename(report.pdfUrl || '');
    const reportsDir = path.join(process.cwd(), 'reports', 'pdf');
    const match = fs.readdirSync(reportsDir)
      .find((file) => file === filename || file.startsWith(filename));
    if (!match) throw new NotFoundException('Report PDF not found');
    const fullPath = path.resolve(reportsDir, match);
    if (!fullPath.startsWith(path.resolve(reportsDir))) throw new NotFoundException('Report PDF not found');
    return { fullPath, filename: match };
  }
}
