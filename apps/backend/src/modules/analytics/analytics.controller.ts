import { Controller, Get, Post, Query, UseGuards, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Platform } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { RealTimeAnalyticsService } from './real-time-analytics.service';
import { BestTimeService } from './best-time.service';
import { AnalyticsSyncService } from './analytics-sync.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { CurrentOrg } from '../../common/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class AnalyticsController {
  constructor(
    private analyticsService: AnalyticsService,
    private realTimeAnalytics: RealTimeAnalyticsService,
    private bestTimeService: BestTimeService,
    private analyticsSync: AnalyticsSyncService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Dashboard overview across all platforms' })
  @ApiQuery({ name: 'period', enum: ['7d', '30d', '90d'], required: false })
  async getOverview(@CurrentOrg() org: any, @Query('period') period: string = '30d') {
    return this.analyticsService.getDashboardOverview(org.id, period);
  }

  @Get('all-best-times')
  @ApiOperation({ summary: 'Get best times for all connected platforms' })
  async getAllBestTimes(@CurrentOrg() org: any, @Query('timezone') timezone?: string) {
    const tz = timezone || 'Asia/Kolkata';
    const results: Record<string, any> = {};
    for (const platform of ['INSTAGRAM', 'FACEBOOK', 'YOUTUBE']) {
      try {
        results[platform.toLowerCase()] = await this.bestTimeService.getBestTimes(org.id, platform, tz);
      } catch {}
    }
    return results;
  }

  @Get('sync-status')
  @ApiOperation({ summary: 'Analytics sync status, API health, and account validation' })
  async getSyncStatus(@CurrentOrg() org: any) {
    return this.analyticsService.getSyncStatus(org.id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Force sync analytics from all connected platforms' })
  async forceSync(@CurrentOrg() org: any) {
    return this.analyticsSync.forceSyncOrg(org.id);
  }

  @Get('youtube/videos')
  @ApiOperation({ summary: 'Get YouTube videos with real stats' })
  async getYouTubeVideos(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.realTimeAnalytics.getYouTubeVideos(org.id, {
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('youtube/stats')
  @ApiOperation({ summary: 'Get YouTube channel stats with Analytics API data' })
  async getYouTubeStats(@CurrentOrg() org: any) {
    return this.realTimeAnalytics.getYouTubeStats(org.id);
  }

  @Get('instagram/realtime')
  @ApiOperation({ summary: 'Get Instagram real-time stats from Graph API' })
  async getInstagramRealtime(@CurrentOrg() org: any) {
    return this.realTimeAnalytics.getInstagramRealtime(org.id);
  }

  @Get('instagram/posts')
  @ApiOperation({ summary: 'Get Instagram posts with real stats' })
  async getInstagramPosts(
    @CurrentOrg() org: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.realTimeAnalytics.getInstagramPosts(org.id, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('facebook/realtime')
  @ApiOperation({ summary: 'Get Facebook real-time stats from Graph API' })
  async getFacebookRealtime(@CurrentOrg() org: any) {
    return this.realTimeAnalytics.getFacebookRealtime(org.id);
  }

  @Get('facebook/posts')
  @ApiOperation({ summary: 'Get Facebook posts with real stats' })
  async getFacebookPosts(
    @CurrentOrg() org: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.realTimeAnalytics.getFacebookPosts(org.id, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('best-times/:platform')
  @ApiOperation({ summary: 'Get best times to post for a platform' })
  async getBestTimes(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('timezone') timezone?: string,
  ) {
    return this.bestTimeService.getBestTimes(org.id, platform.toUpperCase(), timezone || 'Asia/Kolkata');
  }

  @Get(':platform/growth')
  @ApiOperation({ summary: 'Growth chart data' })
  @ApiQuery({ name: 'period', enum: ['7d', '30d', '90d'], required: false })
  async getGrowth(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('period') period: string = '30d',
  ) {
    return this.analyticsService.getGrowthData(org.id, platform.toUpperCase() as Platform, period);
  }

  @Get(':platform/demographics')
  @ApiOperation({ summary: 'Audience demographics from platform APIs' })
  @ApiQuery({ name: 'period', enum: ['7d', '30d', '90d'], required: false })
  async getDemographics(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('period') period: string = '30d',
  ) {
    return this.analyticsService.getDemographics(org.id, platform.toUpperCase() as Platform, period);
  }

  @Get(':platform/top-posts')
  @ApiOperation({ summary: 'Top performing posts' })
  @ApiQuery({ name: 'period', enum: ['7d', '30d', '90d'], required: false })
  async getTopPosts(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('period') period: string = '30d',
  ) {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    return this.analyticsService.getTopPosts(org.id, platform.toUpperCase() as Platform, days);
  }

  @Get(':platform/content-types')
  @ApiOperation({ summary: 'Content type performance breakdown' })
  async getContentTypes(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('period') period: string = '30d',
  ) {
    return this.analyticsService.getContentTypePerformance(org.id, platform.toUpperCase() as Platform, period);
  }

  @Get(':platform/hashtags')
  @ApiOperation({ summary: 'Hashtag performance' })
  async getHashtags(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('period') period: string = '30d',
  ) {
    return this.analyticsService.getHashtagPerformance(org.id, platform.toUpperCase() as Platform, period);
  }

  @Get(':platform')
  @ApiOperation({ summary: 'Platform-specific analytics' })
  @ApiQuery({ name: 'period', enum: ['7d', '30d', '90d'], required: false })
  async getPlatformAnalytics(
    @CurrentOrg() org: any,
    @Param('platform') platform: string,
    @Query('period') period: string = '30d',
  ) {
    return this.analyticsService.getPlatformAnalytics(org.id, platform.toUpperCase() as Platform, period);
  }
}
