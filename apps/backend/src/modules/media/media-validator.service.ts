import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates media files before they are accepted for scheduling.
 * Checks codec, dimensions, duration, aspect ratio, file size, and MIME type.
 *
 * Platform requirements enforced:
 *
 * Instagram Image:  JPEG/PNG, max 8MB, min 320px, max 1440px wide
 * Instagram Reel:   MP4/MOV, H.264 video, AAC audio, 9:16 ratio,
 *                   3–90 seconds, max 1GB, min 500x888px
 * Facebook Image:   JPEG/PNG/GIF, max 10MB
 * Facebook Video:   MP4/MOV, max 10GB, max 240 min
 * YouTube Short:    MP4/MOV, max 60 seconds, 9:16 preferred
 * YouTube Video:    MP4/MOV/AVI/WMV, max 256GB, max 12 hours
 */

export interface MediaValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  meta: {
    width?: number;
    height?: number;
    duration?: number;
    codec?: string;
    audioCodec?: string;
    bitrate?: number;
    fileSize: number;
    mimeType: string;
    aspectRatio?: string;
  };
}

export interface ValidationOptions {
  platform: 'INSTAGRAM' | 'FACEBOOK' | 'YOUTUBE';
  mediaType: 'IMAGE' | 'VIDEO';
  isReel?: boolean;   // Instagram Reel / YouTube Short
  isShort?: boolean;  // YouTube Short
}

@Injectable()
export class MediaValidatorService {
  private readonly logger = new Logger(MediaValidatorService.name);

  /**
   * Validate a media file for a specific platform.
   * Returns errors (blocking) and warnings (non-blocking).
   */
  async validate(filePath: string, mimeType: string, opts: ValidationOptions): Promise<MediaValidationResult> {
    const result: MediaValidationResult = {
      valid: true,
      warnings: [],
      errors: [],
      meta: {
        fileSize: 0,
        mimeType,
      },
    };

    // ── File existence & size ─────────────────────────────
    if (!fs.existsSync(filePath)) {
      result.errors.push(`File not found: ${path.basename(filePath)}`);
      result.valid = false;
      return result;
    }

    const stat = fs.statSync(filePath);
    result.meta.fileSize = stat.size;

    if (stat.size === 0) {
      result.errors.push('File is empty (0 bytes)');
      result.valid = false;
      return result;
    }

    // ── MIME type check ───────────────────────────────────
    const isVideo = mimeType.startsWith('video/');
    const isImage = mimeType.startsWith('image/');

    if (opts.mediaType === 'VIDEO' && !isVideo) {
      result.errors.push(`Expected video file but got: ${mimeType}`);
      result.valid = false;
    }
    if (opts.mediaType === 'IMAGE' && !isImage) {
      result.errors.push(`Expected image file but got: ${mimeType}`);
      result.valid = false;
    }

    // ── Video metadata via ffprobe ────────────────────────
    if (isVideo) {
      try {
        const meta = await this.getVideoMeta(filePath);
        result.meta.width = meta.width;
        result.meta.height = meta.height;
        result.meta.duration = meta.duration;
        result.meta.codec = meta.videoCodec;
        result.meta.audioCodec = meta.audioCodec;
        result.meta.bitrate = meta.bitrate;

        if (meta.width && meta.height) {
          const gcd = this.gcd(meta.width, meta.height);
          result.meta.aspectRatio = `${meta.width / gcd}:${meta.height / gcd}`;
        }

        this.validateVideoForPlatform(result, meta, opts);
      } catch (err: any) {
        // ffprobe not available — warn but don't block
        result.warnings.push(`Could not read video metadata (FFmpeg not installed): ${err.message}`);
      }
    }

    // ── Image metadata via sharp ──────────────────────────
    if (isImage) {
      try {
        const sharp = require('sharp');
        const meta = await sharp(filePath).metadata();
        result.meta.width = meta.width;
        result.meta.height = meta.height;
        this.validateImageForPlatform(result, meta, opts);
      } catch {
        // sharp not available — skip image validation
      }
    }

    // ── Platform-specific file size limits ────────────────
    this.validateFileSize(result, stat.size, opts);

    result.valid = result.errors.length === 0;
    return result;
  }

  // ── Video platform rules ──────────────────────────────────
  private validateVideoForPlatform(
    result: MediaValidationResult,
    meta: VideoMeta,
    opts: ValidationOptions,
  ) {
    const { platform, isReel, isShort } = opts;

    if (platform === 'INSTAGRAM' || isReel) {
      // Instagram Reel requirements
      if (meta.videoCodec && !['h264', 'avc1', 'avc'].includes(meta.videoCodec.toLowerCase())) {
        result.errors.push(
          `Instagram Reels require H.264 video codec. Your video uses: ${meta.videoCodec}. ` +
          `Re-encode with: ffmpeg -i input.mp4 -c:v libx264 -c:a aac output.mp4`,
        );
      }

      if (meta.audioCodec && !['aac', 'mp4a'].includes(meta.audioCodec.toLowerCase())) {
        result.errors.push(
          `Instagram Reels require AAC audio codec. Your audio uses: ${meta.audioCodec}. ` +
          `Re-encode with: ffmpeg -i input.mp4 -c:v libx264 -c:a aac output.mp4`,
        );
      }

      if (meta.duration !== undefined) {
        if (meta.duration < 3) {
          result.errors.push(`Instagram Reels must be at least 3 seconds (yours: ${meta.duration.toFixed(1)}s)`);
        }
        if (meta.duration > 90) {
          result.errors.push(`Instagram Reels must be 90 seconds or less (yours: ${meta.duration.toFixed(1)}s)`);
        }
      }

      if (meta.width && meta.height) {
        const ratio = meta.width / meta.height;
        const isPortrait = ratio < 0.6; // ~9:16 = 0.5625
        if (!isPortrait) {
          result.warnings.push(
            `Instagram Reels perform best in 9:16 portrait format (${meta.width}×${meta.height} = ${ratio.toFixed(2)}:1). ` +
            `Landscape videos will be cropped.`,
          );
        }
        if (meta.width < 500 || meta.height < 888) {
          result.errors.push(
            `Instagram Reels minimum resolution is 500×888px (yours: ${meta.width}×${meta.height})`,
          );
        }
      }
    }

    if (platform === 'FACEBOOK') {
      if (meta.duration !== undefined && meta.duration > 14400) { // 4 hours
        result.errors.push(`Facebook videos must be under 4 hours (yours: ${(meta.duration / 60).toFixed(0)} min)`);
      }
    }

    if (platform === 'YOUTUBE') {
      if (isShort && meta.duration !== undefined && meta.duration > 60) {
        result.warnings.push(
          `YouTube Shorts must be 60 seconds or less (yours: ${meta.duration.toFixed(1)}s). ` +
          `This will be uploaded as a regular video.`,
        );
      }
      if (meta.duration !== undefined && meta.duration > 43200) { // 12 hours
        result.errors.push(`YouTube videos must be under 12 hours`);
      }
    }
  }

  // ── Image platform rules ──────────────────────────────────
  private validateImageForPlatform(
    result: MediaValidationResult,
    meta: { width?: number; height?: number; format?: string },
    opts: ValidationOptions,
  ) {
    const { platform } = opts;

    if (platform === 'INSTAGRAM') {
      if (meta.width && meta.width < 320) {
        result.errors.push(`Instagram images must be at least 320px wide (yours: ${meta.width}px)`);
      }
      if (meta.width && meta.width > 1440) {
        result.warnings.push(`Instagram images wider than 1440px will be downscaled (yours: ${meta.width}px)`);
      }
      if (meta.format && !['jpeg', 'jpg', 'png'].includes(meta.format.toLowerCase())) {
        result.errors.push(`Instagram only supports JPEG and PNG images (yours: ${meta.format})`);
      }
    }
  }

  // ── File size limits ──────────────────────────────────────
  private validateFileSize(
    result: MediaValidationResult,
    size: number,
    opts: ValidationOptions,
  ) {
    const MB = 1024 * 1024;
    const GB = 1024 * MB;

    const limits: Record<string, Record<string, number>> = {
      INSTAGRAM: { IMAGE: 8 * MB, VIDEO: 1 * GB },
      FACEBOOK:  { IMAGE: 10 * MB, VIDEO: 10 * GB },
      YOUTUBE:   { IMAGE: 0, VIDEO: 256 * GB },
    };

    const limit = limits[opts.platform]?.[opts.mediaType];
    if (limit && size > limit) {
      const limitStr = limit >= GB ? `${(limit / GB).toFixed(0)}GB` : `${(limit / MB).toFixed(0)}MB`;
      const sizeStr = size >= GB ? `${(size / GB).toFixed(2)}GB` : `${(size / MB).toFixed(1)}MB`;
      result.errors.push(`File too large for ${opts.platform}: max ${limitStr}, yours is ${sizeStr}`);
    }
  }

  // ── ffprobe wrapper ───────────────────────────────────────
  private async getVideoMeta(filePath: string): Promise<VideoMeta> {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = (process.env.FFMPEG_PATH || '').trim().replace(/^['"]|['"]$/g, '');
    const ffprobePath = (process.env.FFPROBE_PATH || '').trim().replace(/^['"]|['"]$/g, '');
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err) return reject(err);

        const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
        const audioStream = metadata.streams.find((s: any) => s.codec_type === 'audio');

        resolve({
          duration: parseFloat(metadata.format.duration) || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          videoCodec: videoStream?.codec_name || '',
          audioCodec: audioStream?.codec_name || '',
          bitrate: parseInt(String(metadata.format.bit_rate || '0')),
        });
      });
    });
  }

  private gcd(a: number, b: number): number {
    return b === 0 ? a : this.gcd(b, a % b);
  }

  /**
   * Quick synchronous check — just file existence and size.
   * Used by the scheduler before publishing.
   */
  quickCheck(filePath: string): { ok: boolean; error?: string } {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File not found: ${path.basename(filePath)}` };
    }
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { ok: false, error: `File is empty: ${path.basename(filePath)}` };
    }
    return { ok: true };
  }
}

interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  bitrate: number;
}
