import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { RealTimeAnalyticsService } from './real-time-analytics.service';
import { BestTimeService } from './best-time.service';
import { IntegrationModule } from '../integration/integration.module';
import { AnalyticsSyncService } from './analytics-sync.service';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { InstagramAnalyticsService } from './instagram-analytics.service';
import { FacebookAnalyticsService } from './facebook-analytics.service';
import { YouTubeAnalyticsService } from './youtube-analytics.service';

@Module({
  imports: [IntegrationModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    RealTimeAnalyticsService,
    BestTimeService,
    AnalyticsSyncService,
    AnalyticsSnapshotService,
    InstagramAnalyticsService,
    FacebookAnalyticsService,
    YouTubeAnalyticsService,
  ],
  exports: [
    AnalyticsService,
    RealTimeAnalyticsService,
    BestTimeService,
    AnalyticsSyncService,
    AnalyticsSnapshotService,
  ],
})
export class AnalyticsModule {}
