import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { MetaOAuthService } from './providers/meta-oauth.service';
import { YoutubeOAuthService } from './providers/youtube-oauth.service';
import { InstagramOAuthService } from './providers/instagram-oauth.service';
import { LinkedinOAuthService } from './providers/linkedin-oauth.service';
import { ThreadsOAuthService } from './providers/threads-oauth.service';
import { GoogleBusinessOAuthService } from './providers/google-business-oauth.service';
import { TokenRefreshService } from './token-refresh.service';

@Module({
  controllers: [IntegrationController],
  providers: [
    IntegrationService,
    MetaOAuthService,
    YoutubeOAuthService,
    InstagramOAuthService,
    LinkedinOAuthService,
    ThreadsOAuthService,
    GoogleBusinessOAuthService,
    TokenRefreshService,
  ],
  exports: [
    IntegrationService,
    TokenRefreshService,
    MetaOAuthService,
    YoutubeOAuthService,
    InstagramOAuthService,
    LinkedinOAuthService,
    ThreadsOAuthService,
    GoogleBusinessOAuthService,
  ],
})
export class IntegrationModule {}
