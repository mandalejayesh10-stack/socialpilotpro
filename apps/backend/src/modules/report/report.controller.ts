import { Controller, Get, Post, Body, Param, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { CurrentOrg } from '../../common/decorators/current-user.decorator';
import { Platform } from '@prisma/client';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class ReportController {
  constructor(private reportService: ReportService) {}

  @Get()
  async getReports(@CurrentOrg() org: any) {
    return this.reportService.getReports(org.id);
  }

  @Post()
  async createReport(
    @CurrentOrg() org: any,
    @Body() body: {
      title: string;
      platform?: Platform;
      periodStart: string;
      periodEnd: string;
      emailTo?: string;
    },
  ) {
    return this.reportService.createReport({
      organizationId: org.id,
      title: body.title,
      platform: body.platform,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      emailTo: body.emailTo,
    });
  }

  @Get(':id')
  async getReport(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.reportService.getReport(org.id, id);
  }

  @Get(':id/download')
  async downloadReport(@CurrentOrg() org: any, @Param('id') id: string, @Res() res: Response) {
    const file = await this.reportService.getReportFile(org.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.sendFile(file.fullPath);
  }

  @Post(':id/retry')
  async retryReport(@CurrentOrg() org: any, @Param('id') id: string) {
    const report = await this.reportService.getReport(org.id, id);
    return this.reportService.generateReport(report.id);
  }
}
