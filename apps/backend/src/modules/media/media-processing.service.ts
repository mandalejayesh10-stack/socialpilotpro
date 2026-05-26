import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { FfmpegService } from './ffmpeg.service';
import { StorageService } from './storage.service';
import { MediaUrlValidatorService } from './media-url-validator.service';
import * as fs from 'fs';
import * as path from 'path';

export const MEDIA_STATUSES = {
  UPLOADING: 'UPLOADING',
  PROCESSING: 'PROCESSING',
  OPTIMIZING: 'OPTIMIZING',
  GENERATING_THUMBNAIL: 'GENERATING_THUMBNAIL',
  UPLOADING_TO_CLOUD: 'UPLOADING_TO_CLOUD',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
} as const;

@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private ffmpeg: FfmpegService,
    private storage: StorageService,
    private urlValidator: MediaUrlValidatorService,
  ) {}

  async enqueue(mediaId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return;

    await this.prisma.uploadJob.create({
      data: {
        organizationId: media.organizationId,
        mediaId: media.id,
        provider: this.storage.getProvider(),
        sourcePath: media.path,
        publicUrl: media.url,
        thumbnailUrl: media.thumbnail,
        status: MEDIA_STATUSES.PROCESSING,
      },
    });

    setTimeout(() => {
      this.process(mediaId).catch((err) => {
        this.logger.error(`Processing failed for ${mediaId}: ${err.message}`, err.stack);
      });
    }, 0);
  }

  async process(mediaId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return;

    try {
      await this.setStatus(media.id, MEDIA_STATUSES.PROCESSING);

      let finalPath = media.path;
      let finalMime = media.mimeType || 'application/octet-stream';
      let finalName = media.name;
      let finalMeta: any = this.parseJson(media.processingMeta);

      if (media.mimeType?.startsWith('video/')) {
        const meta = await this.ffmpeg.getMetadata(media.path);
        const needsShortFormRepair =
          !meta.isShortForm ||
          meta.width < 720 ||
          meta.height < 1280 ||
          meta.codec !== 'h264' ||
          (meta.audioCodec && meta.audioCodec !== 'aac');

        if (needsShortFormRepair) {
          await this.setStatus(media.id, MEDIA_STATUSES.OPTIMIZING, 'Optimizing video for Instagram Reel and YouTube Shorts...');
          const optimizedPath = await this.ffmpeg.optimizeForShortForm(media.path);
          const optimizedName = path.basename(optimizedPath);
          const uploadDir = process.env.UPLOAD_DIRECTORY || './uploads';
          const finalOutputPath = path.join(uploadDir, optimizedName);
          fs.copyFileSync(optimizedPath, finalOutputPath);
          this.ffmpeg.cleanup(optimizedPath);
          finalPath = finalOutputPath;
          finalName = optimizedName;
          finalMime = 'video/mp4';
          finalMeta = {
            ...finalMeta,
            optimized: true,
            optimizationReason: 'short_form_repair',
          };
        }

        await this.setStatus(media.id, MEDIA_STATUSES.GENERATING_THUMBNAIL, 'Generating final video thumbnail...');
        const thumbPath = await this.ffmpeg.extractThumbnail(finalPath);
        if (thumbPath) {
          const thumbName = path.basename(thumbPath);
          const thumbUrl = await this.uploadWithRetry(thumbPath, thumbName, 'image/jpeg', media.id, 'thumbnail');
          this.ffmpeg.cleanup(thumbPath);
          finalMeta.thumbnailUrl = thumbUrl;
          await this.prisma.media.update({
            where: { id: media.id },
            data: { thumbnail: thumbUrl, thumbnailUrl: thumbUrl },
          });
        }

        const repairedMeta = await this.ffmpeg.getMetadata(finalPath);
        finalMeta = {
          ...finalMeta,
          codec: repairedMeta.codec,
          audioCodec: repairedMeta.audioCodec,
          bitrate: repairedMeta.bitrate,
          aspectRatio: repairedMeta.aspectRatio,
          isPortrait: repairedMeta.isPortrait,
          isShortForm: repairedMeta.isShortForm,
        };
        await this.prisma.media.update({
          where: { id: media.id },
          data: {
            name: finalName,
            path: finalPath,
            mimeType: finalMime,
            width: repairedMeta.width || media.width,
            height: repairedMeta.height || media.height,
            duration: repairedMeta.duration || media.duration,
            aspectRatio: repairedMeta.aspectRatio || media.aspectRatio,
            isPortrait: repairedMeta.isPortrait,
            isShortForm: repairedMeta.isShortForm,
            processingMeta: JSON.stringify(finalMeta),
          },
        });
      }

      await this.setStatus(media.id, MEDIA_STATUSES.UPLOADING_TO_CLOUD, 'Preparing secure cloud upload...');
      if (!this.storage.isPublishSafeProvider()) {
        throw new Error('Public upload URL is not configured. Set LOCAL_UPLOAD_PUBLIC_BASE_URL or BACKEND_PUBLIC_URL to your Railway HTTPS app URL.');
      }

      const publicUrl = await this.uploadWithRetry(finalPath, finalName, finalMime, media.id, 'original');
      const validation = await this.urlValidator.validate(publicUrl, finalMime.startsWith('video/') ? 'video' : finalMime.startsWith('image/') ? 'image' : 'any');
      if (!validation.ok) {
        throw new Error(`Cloud media URL is not reachable yet: ${validation.reason}`);
      }

      const meta = finalMime.startsWith('video/') ? await this.ffmpeg.getMetadata(finalPath) : null;
      await this.prisma.media.update({
        where: { id: media.id },
        data: {
          name: finalName,
          path: finalPath,
          url: publicUrl,
          originalUrl: publicUrl,
          mimeType: finalMime,
          storageProvider: this.storage.getProvider(),
          width: meta?.width || media.width,
          height: meta?.height || media.height,
          duration: meta?.duration || media.duration,
          aspectRatio: meta?.aspectRatio || media.aspectRatio,
          isPortrait: meta?.isPortrait ?? media.isPortrait,
          isShortForm: meta?.isShortForm ?? media.isShortForm,
          processingStatus: MEDIA_STATUSES.READY_TO_PUBLISH,
          publishReady: true,
          validationError: null,
          processingMeta: JSON.stringify({
            ...finalMeta,
            publicValidation: validation,
            storageProvider: this.storage.getProvider(),
            publishSafeStorage: true,
          }),
        },
      });

      await this.updateJob(media.id, MEDIA_STATUSES.READY_TO_PUBLISH, publicUrl, null);
    } catch (err: any) {
      await this.setStatus(media.id, MEDIA_STATUSES.VALIDATION_FAILED, this.toUserMessage(err.message));
      await this.updateJob(media.id, MEDIA_STATUSES.VALIDATION_FAILED, null, err.message);
    }
  }

  private async uploadWithRetry(filePath: string, filename: string, mimeType: string, mediaId: string, label: string): Promise<string> {
    const max = Number(process.env.STORAGE_UPLOAD_MAX_RETRIES || 3);
    let lastError: any;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const url = await this.storage.upload(filePath, filename, mimeType);
        this.logger.log(`[MediaProcessing] Uploaded ${label} media=${mediaId} attempt=${attempt} url=${url}`);
        return url;
      } catch (err: any) {
        lastError = err;
        await this.prisma.uploadJob.updateMany({
          where: { mediaId },
          data: { attempts: { increment: 1 }, error: err.message },
        });
        if (attempt < max) await new Promise((r) => setTimeout(r, 750 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  private async setStatus(mediaId: string, status: string, message?: string) {
    await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        processingStatus: status,
        validationError: message || null,
        publishReady: status === MEDIA_STATUSES.READY_TO_PUBLISH,
      },
    });
  }

  private async updateJob(mediaId: string, status: string, publicUrl: string | null, error: string | null) {
    await this.prisma.uploadJob.updateMany({
      where: { mediaId },
      data: { status, publicUrl: publicUrl || undefined, error: error || undefined },
    });
  }

  private parseJson(value: string | null | undefined) {
    try {
      return value ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  }

  private toUserMessage(message: string) {
    if (message.includes('Public upload URL is not configured')) return 'Waiting for public upload URL...';
    if (message.includes('Cloud storage is not configured')) return 'Preparing secure cloud upload...';
    if (message.includes('FFmpeg')) return 'Video optimization is temporarily unavailable.';
    return message;
  }
}
