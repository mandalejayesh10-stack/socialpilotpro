import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { FfmpegService } from './ffmpeg.service';
import { StorageService } from './storage.service';
import { MediaValidatorService } from './media-validator.service';
import { MediaUrlValidatorService } from './media-url-validator.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingWorker } from './media-processing.worker';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    FfmpegService,
    StorageService,
    MediaValidatorService,
    MediaUrlValidatorService,
    MediaProcessingService,
    MediaProcessingWorker,
  ],
  exports: [MediaService, StorageService, MediaValidatorService, MediaUrlValidatorService, MediaProcessingService],
})
export class MediaModule {}
