import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { FfmpegService, ProcessVideoOptions } from './ffmpeg.service';
import { MediaValidatorService } from './media-validator.service';
import { StorageService } from './storage.service';
import { MediaUrlValidatorService } from './media-url-validator.service';
import { MediaProcessingService, MEDIA_STATUSES } from './media-processing.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly uploadDir = process.env.UPLOAD_DIRECTORY || './uploads';

  constructor(
    private prisma: PrismaService,
    private ffmpeg: FfmpegService,
    private validator: MediaValidatorService,
    private storage: StorageService,
    private urlValidator: MediaUrlValidatorService,
    private processor: MediaProcessingService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadMedia(
    organizationId: string,
    file: Express.Multer.File,
  ) {
    try {
      this.validateUploadedFile(file);
    } catch (err) {
      this.safeUnlink(file.path);
      throw err;
    }

    const isVideo = file.mimetype.startsWith('video/');
    const isAudio = file.mimetype.startsWith('audio/');
    const type = isVideo ? 'VIDEO' : isAudio ? 'AUDIO' : 'IMAGE';

    let thumbnail: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;
    let processingMeta: any = undefined;

    if (isVideo) {
      try {
        const meta = await this.ffmpeg.getMetadata(file.path);
        width = meta.width || undefined;
        height = meta.height || undefined;
        duration = meta.duration || undefined;
        processingMeta = {
          codec: meta.codec,
          audioCodec: meta.audioCodec,
          bitrate: meta.bitrate,
          aspectRatio: meta.aspectRatio,
          isPortrait: meta.isPortrait,
          isShortForm: meta.isShortForm,
          metadataExtracted: Boolean(meta.width || meta.height || meta.duration),
        };
      } catch (err: any) {
        this.logger.warn(`Video metadata extraction failed for ${file.originalname}: ${err.message}`);
        processingMeta = {
          metadataExtracted: false,
          metadataError: err.message,
        };
      }

      try {
        const thumbPath = await this.ffmpeg.extractThumbnail(file.path);
        if (thumbPath) {
          // Move thumbnail from tmp dir into uploads dir so it's served statically
          const thumbFilename = path.basename(thumbPath);
          const destPath = path.join(this.uploadDir, thumbFilename);
          if (thumbPath !== destPath) {
            fs.copyFileSync(thumbPath, destPath);
            this.ffmpeg.cleanup(thumbPath);
          }
          thumbnail = thumbFilename;
        }
      } catch (err: any) {
        this.logger.warn(`Video thumbnail extraction failed for ${file.originalname}: ${err.message}`);
      }
    }

    if (type === 'IMAGE') {
      try {
        const sharp = require('sharp');
        const meta = await sharp(file.path).metadata();
        width = meta.width;
        height = meta.height;
      } catch {
        // sharp not available, skip metadata
      }
    }

    const publicUrl = await this.uploadWithRetry(file.path, file.filename, file.mimetype, 'original');
    let thumbnailUrl: string | undefined;
    if (thumbnail) {
      const thumbnailPath = path.join(this.uploadDir, thumbnail);
      thumbnailUrl = await this.uploadWithRetry(thumbnailPath, thumbnail, 'image/jpeg', 'thumbnail');
    }
    const publicValidation = await this.urlValidator.validate(publicUrl, isVideo ? 'video' : type === 'IMAGE' ? 'image' : 'audio');
    const thumbnailValidation = thumbnailUrl ? await this.urlValidator.validate(thumbnailUrl, 'image') : null;
    this.logger.log(
      `[MediaUpload] ${file.originalname} provider=${this.storage.getProvider()} url=${publicUrl} ` +
      `publicOk=${publicValidation.ok} status=${publicValidation.status || '-'} mime=${publicValidation.contentType || '-'}`,
    );

    const media = await this.prisma.media.create({
      data: {
        organizationId,
        name: file.filename,
        originalName: file.originalname,
        path: file.path,
        // Store relative URL — frontend prepends NEXT_PUBLIC_BACKEND_URL at render time.
        url: publicUrl,
        originalUrl: publicUrl,
        type: type as any,
        mimeType: file.mimetype,
        fileSize: file.size,
        width,
        height,
        duration,
        thumbnail: thumbnailUrl,
        thumbnailUrl,
        storageProvider: this.storage.getProvider(),
        aspectRatio: processingMeta?.aspectRatio,
        isPortrait: Boolean(processingMeta?.isPortrait),
        isShortForm: Boolean(processingMeta?.isShortForm),
        processingStatus: this.storage.isPublishSafeProvider() ? MEDIA_STATUSES.UPLOADING_TO_CLOUD : MEDIA_STATUSES.PROCESSING,
        publishReady: false,
        validationError: this.storage.isPublishSafeProvider() ? null : 'Waiting for public upload URL...',
        processingMeta: JSON.stringify({
          ...(processingMeta || {}),
          originalUrl: publicUrl,
          thumbnailUrl,
          storageProvider: this.storage.getProvider(),
          publishSafeStorage: this.storage.isPublishSafeProvider(),
          publicValidation,
          thumbnailValidation,
        }),
      },
    });

    this.processor.enqueue(media.id).catch((err) => {
      this.logger.warn(`Failed to enqueue media processing: ${err.message}`);
    });

    return media;
  }

  async processVideo(
    organizationId: string,
    mediaId: string,
    options: ProcessVideoOptions,
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, organizationId, deletedAt: null },
    });
    if (!media) throw new NotFoundException('Media not found');

    const outputPath = await this.ffmpeg.processVideo(media.path, options);
    const meta = await this.ffmpeg.getMetadata(outputPath);
    const thumbPath = await this.ffmpeg.extractThumbnail(outputPath);

    // Move processed file from tmp dir into the uploads dir so it's served statically
    const uploadDir = process.env.UPLOAD_DIRECTORY || './uploads';
    const outputFilename = path.basename(outputPath);
    const finalOutputPath = path.join(uploadDir, outputFilename);
    if (outputPath !== finalOutputPath) {
      fs.copyFileSync(outputPath, finalOutputPath);
      this.ffmpeg.cleanup(outputPath);
    }

    // Move thumbnail into uploads dir too
    let thumbnailUrl: string | undefined;
    if (thumbPath) {
      const thumbFilename = path.basename(thumbPath);
      const finalThumbPath = path.join(uploadDir, thumbFilename);
      if (thumbPath !== finalThumbPath) {
        fs.copyFileSync(thumbPath, finalThumbPath);
        this.ffmpeg.cleanup(thumbPath);
      }
      thumbnailUrl = await this.uploadWithRetry(finalThumbPath, thumbFilename, 'image/jpeg', 'processed thumbnail');
    }

    const processedUrl = await this.uploadWithRetry(finalOutputPath, outputFilename, 'video/mp4', 'processed video');

    const processed = await this.prisma.media.create({
      data: {
        organizationId,
        name: outputFilename,
        originalName: media.originalName,
        path: finalOutputPath,
        url: processedUrl,
        originalUrl: processedUrl,
        type: 'PROCESSED_VIDEO',
        mimeType: 'video/mp4',
        fileSize: fs.statSync(finalOutputPath).size,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        thumbnail: thumbnailUrl,
        thumbnailUrl,
        storageProvider: this.storage.getProvider(),
        aspectRatio: meta.aspectRatio,
        isPortrait: meta.isPortrait,
        isShortForm: meta.isShortForm,
        processed: true,
        processingMeta: JSON.stringify({
          ...options,
          codec: meta.codec,
          audioCodec: meta.audioCodec,
          bitrate: meta.bitrate,
          aspectRatio: meta.aspectRatio,
          isPortrait: meta.isPortrait,
          isShortForm: meta.isShortForm,
          originalUrl: processedUrl,
          thumbnailUrl,
          storageProvider: this.storage.getProvider(),
          publishSafeStorage: this.storage.isPublishSafeProvider(),
        }),
      },
    });

    return processed;
  }

  async getMedia(organizationId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(100, Math.max(1, limit || 20));
    const skip = (safePage - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.prisma.media.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.media.count({ where: { organizationId, deletedAt: null } }),
    ]);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
  }

  async deleteMedia(organizationId: string, mediaId: string) {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, organizationId, deletedAt: null },
    });
    if (!media) throw new NotFoundException('Media not found');

    await this.prisma.media.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() },
    });

    this.storage.delete(media.url).catch((err) => {
      this.logger.warn(`Failed to delete media from storage: ${err.message}`);
    });
    if (media.thumbnail) {
      this.storage.delete(media.thumbnail).catch((err) => {
        this.logger.warn(`Failed to delete thumbnail from storage: ${err.message}`);
      });
    }

    return { message: 'Media deleted' };
  }

  async validateForPlatform(
    organizationId: string,
    mediaId: string,
    opts: { platform: 'INSTAGRAM' | 'FACEBOOK' | 'YOUTUBE'; isReel?: boolean; isShort?: boolean },
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, organizationId, deletedAt: null },
    });
    if (!media) throw new NotFoundException('Media not found');

    const localPath = media.path && fs.existsSync(media.path)
      ? media.path
      : path.resolve(process.cwd(), this.uploadDir, media.name);
    const mediaType = media.type === 'IMAGE' ? 'IMAGE' : 'VIDEO';

    const result = await this.validator.validate(localPath, media.mimeType || '', {
      platform: opts.platform,
      mediaType,
      isReel: opts.isReel,
      isShort: opts.isShort,
    });

    const mediaKind = media.mimeType?.startsWith('video/') ? 'video' : media.mimeType?.startsWith('image/') ? 'image' : 'any';
    const publicUrlValidation = await this.urlValidator.validate(media.url || '', mediaKind as any);
    const thumbnailValidation = media.thumbnail ? await this.urlValidator.validate(media.thumbnail, 'image') : null;
    const requiresPublicUrl = opts.platform === 'INSTAGRAM' || opts.platform === 'FACEBOOK';
    const publicUrlOk = !requiresPublicUrl || publicUrlValidation.ok;

    return {
      mediaId,
      platform: opts.platform,
      storage: this.storage.getStatus(),
      publicUrlValidation,
      thumbnailValidation,
      publishReady: result.valid && publicUrlValidation.ok && publicUrlOk,
      publishBlockedReason: !publicUrlOk
        ? 'Media needs a public HTTPS upload URL before publishing.'
        : !publicUrlValidation.ok
          ? publicUrlValidation.reason
          : undefined,
      ...result,
    };
  }

  async getStatus() {
    return {
      storage: await this.storage.healthCheck(),
      uploadDir: {
        path: this.uploadDir,
        exists: fs.existsSync(this.uploadDir),
      },
    };
  }

  private async uploadWithRetry(filePath: string, filename: string, mimeType: string, label: string): Promise<string> {
    const max = Number(process.env.STORAGE_UPLOAD_MAX_RETRIES || 3);
    let lastError: any;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const url = await this.storage.upload(filePath, filename, mimeType);
        this.logger.log(`[Storage] Uploaded ${label} attempt=${attempt} provider=${this.storage.getProvider()} url=${url}`);
        return url;
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`[Storage] Upload ${label} failed attempt=${attempt}/${max}: ${err.message}`);
        if (attempt < max) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  private validateUploadedFile(file: Express.Multer.File) {
    const maxSize = Number(process.env.MAX_UPLOAD_BYTES || 500 * 1024 * 1024);
    if (file.size > maxSize) {
      throw new BadRequestException(`File exceeds upload limit of ${Math.floor(maxSize / 1024 / 1024)}MB`);
    }

    const ext = path.extname(file.originalname || file.filename).toLowerCase();
    const allowedExt = new Set([
      '.jpg', '.jpeg', '.png', '.webp', '.gif',
      '.mp4', '.mov', '.m4v', '.webm',
      '.mp3', '.m4a', '.aac', '.wav',
    ]);
    if (!allowedExt.has(ext)) {
      throw new BadRequestException(`Unsupported file extension: ${ext || 'none'}`);
    }

    const forbiddenExt = new Set(['.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.js', '.html', '.svg', '.php', '.jar']);
    if (forbiddenExt.has(ext)) {
      throw new BadRequestException('Executable or script uploads are not allowed');
    }

    const header = fs.readFileSync(file.path).subarray(0, 16);
    const detected = this.detectMagicType(header);
    if (!detected) {
      throw new BadRequestException('Unsupported or unreadable media file');
    }
    if (!file.mimetype.startsWith(`${detected}/`)) {
      throw new BadRequestException(`MIME type mismatch: uploaded as ${file.mimetype}, detected ${detected}`);
    }
  }

  private detectMagicType(header: Buffer): 'image' | 'video' | 'audio' | null {
    const hex = header.toString('hex');
    const ascii = header.toString('ascii');
    if (hex.startsWith('ffd8ff') || hex.startsWith('89504e47') || ascii.startsWith('GIF8') || ascii.startsWith('RIFF') && ascii.includes('WEBP')) {
      return 'image';
    }
    if (ascii.includes('ftyp') || ascii.startsWith('RIFF') && ascii.includes('WEBM')) {
      return 'video';
    }
    if (ascii.startsWith('ID3') || hex.startsWith('fff') || ascii.startsWith('RIFF') && ascii.includes('WAVE')) {
      return 'audio';
    }
    return null;
  }

  private safeUnlink(filePath: string) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup.
    }
  }
}
