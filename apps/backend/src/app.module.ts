import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { DatabaseModule } from './modules/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { PostModule } from './modules/post/post.module';
import { MediaModule } from './modules/media/media.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { BillingModule } from './modules/billing/billing.module';
import { ReportModule } from './modules/report/report.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationModule } from './modules/notification/notification.module';
import { SettingsModule } from './modules/settings/settings.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { CustomThrottlerGuard } from './common/guards/throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { HealthModule } from './modules/health/health.module';
import { InboxModule } from './modules/inbox/inbox.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 20,
      },
      {
        name: 'medium',
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
        limit: parseInt(process.env.RATE_LIMIT_MAX || '100'),
      },
    ]),
    DatabaseModule,
    AuthModule,
    OrganizationModule,
    IntegrationModule,
    PostModule,
    MediaModule,
    AnalyticsModule,
    PipelineModule,
    BillingModule,
    ReportModule,
    AiModule,
    NotificationModule,
    SettingsModule,
    WebhookModule,
    HealthModule,
    InboxModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    PermissionsGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityMiddleware).forRoutes('*');
  }
}
