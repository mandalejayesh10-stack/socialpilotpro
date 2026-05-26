import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { MetaOAuthService } from './providers/meta-oauth.service';
import { YoutubeOAuthService } from './providers/youtube-oauth.service';
import { TokenRefreshService } from './token-refresh.service';

@Module({
  controllers: [IntegrationController],
  providers: [
    IntegrationService,
    MetaOAuthService,
    YoutubeOAuthService,
    TokenRefreshService,
  ],
  exports: [IntegrationService, TokenRefreshService, MetaOAuthService, YoutubeOAuthService],
})
export class IntegrationModule {}
