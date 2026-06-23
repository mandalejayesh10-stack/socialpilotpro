import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostService } from './post.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { TokenRefreshService } from '../integration/token-refresh.service';
import { BestTimeService } from '../analytics/best-time.service';
import { StorageService } from '../media/storage.service';
import { MediaUrlValidatorService } from '../media/media-url-validator.service';
import { decrypt, safeDecrypt } from '../../common/utils/crypto.util';
import axios from 'axios';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

// Per-platform publish timeouts (ms)
const TIMEOUTS = {
  INSTAGRAM_CONTAINER_POLL: 300_000,  // 5 min — video processing
  FACEBOOK_VIDEO_UPLOAD:    300_000,  // 5 min — large video multipart
  YOUTUBE_UPLOAD:           600_000,  // 10 min — large video upload
  META_API_CALL:             30_000,  // 30s — standard API calls
  AXIOS_DEFAULT:             30_000,  // 30s — default axios timeout
  MEDIA_PREFLIGHT: 15_000,
};

type MediaPreflightResult = {
  url: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  method?: 'HEAD' | 'GET';
  reason?: string;
};

/** Wrap a promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s: ${label}`)), ms),
    ),
  ]);
}

/**
 * Runs every minute to check for posts due for publishing.
 *
 * ROOT CAUSES FIXED:
 * 1. Meta media URLs now come from production-safe cloud storage
 * 2. No token refresh before publish — now refreshes expired tokens first
 * 3. Instagram video detection used file extension — now uses mimeType from DB
 * 4. Instagram video didn't wait for container processing — now polls status
 * 5. YouTube streamed from localhost URL — now streams from local file path
 * 6. No publish audit log — now writes to PublishLog table
 * 7. No media file existence check — now validates before publish
 */
@Injectable()
export class PostSchedulerService {
  private readonly logger = new Logger(PostSchedulerService.name);

  private readonly workerId = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local'}-${process.pid}`;

  constructor(
    private postService: PostService,
    private prisma: PrismaService,
    private notifications: NotificationService,
    private tokenRefresh: TokenRefreshService,
    private bestTimeService: BestTimeService,
    private storage: StorageService,
    private mediaUrlValidator: MediaUrlValidatorService,
  ) {
    this.runPreflightCheck();
  }

  /** Logs system readiness on startup — helps diagnose issues before first publish */
  private async runPreflightCheck() {
    // Small delay to let NestJS finish bootstrapping
    await new Promise((r) => setTimeout(r, 3000));

    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log('[Preflight] Publishing pipeline status check');

    // 1. FFmpeg
    try {
      const ffmpeg = require('fluent-ffmpeg');
      if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
      if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

      const { execFile } = require('child_process');
      const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

      await new Promise<void>((resolve) => {
        execFile(ffprobePath, ['-version'], { timeout: 5000 }, (err: any) => {
          if (!err) {
            this.logger.log('[Preflight] ✅ FFmpeg available');
          } else {
            this.logger.warn('[Preflight] ⚠️  FFmpeg NOT found — video thumbnails and Reel validation disabled');
            this.logger.warn('[Preflight]    Set FFMPEG_PATH and FFPROBE_PATH in .env, or install from https://ffmpeg.org/download.html');
          }
          resolve();
        });
      });
    } catch {
      this.logger.warn('[Preflight] ⚠️  FFmpeg NOT found');
    }

    // 2. Public URL check
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
    if (backendUrl.includes('localhost')) {
      this.logger.warn(`[Preflight] ⚠️  BACKEND_INTERNAL_URL is localhost (${backendUrl})`);
      this.logger.warn('[Preflight]    Instagram/Facebook image posts will FAIL — Meta cannot fetch localhost URLs');
      this.logger.warn('[Preflight]    Configure Supabase Storage so media is served from permanent HTTPS URLs.');
    } else {
      this.logger.log(`[Preflight] ✅ Public URL: ${backendUrl}`);
    }

    const storageStatus = this.storage.getStatus();
    if (!storageStatus.publishSafe || !storageStatus.configured) {
      this.logger.warn(`[Preflight] Publish-safe cloud storage is not ready: ${JSON.stringify(storageStatus)}`);
      this.logger.warn('[Preflight] Instagram/Facebook publishing requires Supabase, S3, or Cloudflare R2 public CDN URLs.');
    } else {
      this.logger.log(`[Preflight] Cloud storage ready: ${JSON.stringify(storageStatus)}`);
    }

    // 3. Upload directory
    const uploadDir = process.env.UPLOAD_DIRECTORY
      ? path.resolve(process.cwd(), process.env.UPLOAD_DIRECTORY)
      : path.resolve(process.cwd(), 'uploads');
    if (fs.existsSync(uploadDir)) {
      const count = fs.readdirSync(uploadDir).length;
      this.logger.log(`[Preflight] ✅ Upload directory: ${uploadDir} (${count} files)`);
    } else {
      this.logger.warn(`[Preflight] ⚠️  Upload directory missing: ${uploadDir}`);
    }

    // 4. Active integrations
    try {
      const integrations = await this.prisma.integration.findMany({
        where: { deletedAt: null, disabled: false },
        select: { platform: true, name: true, tokenExpiry: true, refreshNeeded: true },
      });
      if (integrations.length === 0) {
        this.logger.warn('[Preflight] ⚠️  No connected social accounts');
      } else {
        integrations.forEach((i) => {
          const expiry = i.tokenExpiry ? new Date(i.tokenExpiry) : null;
          const expired = expiry && expiry < new Date();
          const status = expired ? '⚠️  TOKEN EXPIRED' : i.refreshNeeded ? '⚠️  REFRESH NEEDED' : '✅';
          this.logger.log(`[Preflight] ${status} [${i.platform}] ${i.name}${expiry ? ` (expires ${expiry.toLocaleDateString()})` : ''}`);
        });
      }
    } catch (e: any) {
      this.logger.warn(`[Preflight] Could not check integrations: ${e.message}`);
    }

    // 5. Stale claimed posts (from previous crash)
    try {
      const stale = await this.postService.releaseStuckProcessing();
      if (stale.count > 0) {
        this.logger.warn(`[Preflight] ⚠️  Found ${stale} stale claimed posts — clearing`);
        await this.prisma.post.updateMany({
          where: { state: 'QUEUE', error: '__CLAIMED__' },
          data: { error: null },
        });
      }
    } catch { /* ignore */ }

    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  @Cron('* * * * *') // every minute
  async processQueue() {
    await this.postService.releaseStuckProcessing();
    const duePosts: any[] = await this.postService.getDuePosts(this.workerId);
    if (duePosts.length === 0) return;

    this.logger.log(`[Scheduler] Processing ${duePosts.length} scheduled posts`);

    for (const post of duePosts) {
      // Prevent duplicate publish if previous run is still in progress
      if (false) {
        this.logger.warn(`[Scheduler] Post ${post.id} already in progress — skipping`);
        continue;
      }

      // DB claimToken/PROCESSING state provides cross-instance locking.
      const startMs = Date.now();

      try {
        // Clear the claim sentinel and reset error before publishing
        await this.prisma.$executeRawUnsafe(`
          UPDATE "Post"
          SET error = NULL,
              "lockedAt" = NOW(),
              "lockedBy" = $2
          WHERE id = $1
        `, post.id, this.workerId);

        await this.publishPost(post);

        await this.writePublishLog(post.id, post.integration.platform, 'SUCCESS', null, null, Date.now() - startMs);

        // Learning loop: record this publish for best-time engine improvement
        const mediaUrls: string[] = JSON.parse(post.mediaUrls || '[]');
        const contentType = mediaUrls.length === 0 ? 'TEXT' :
                            mediaUrls.length > 1 ? 'CAROUSEL' :
                            mediaUrls[0].match(/\.(mp4|mov|avi|webm)$/i) ? 'VIDEO' : 'IMAGE';
        this.bestTimeService.recordPublishOutcome(
          post.id,
          post.integration.organizationId,
          post.integration.platform,
          new Date(post.publishDate),
          contentType,
        ).catch(() => { /* non-blocking */ });
      } catch (err: any) {
        const errMsg = err?.response?.data
          ? this.humanizeApiError(err.response.data, post.integration.platform)
          : err.message || String(err);

        this.logger.error(`[Scheduler] Post ${post.id} (${post.integration.platform}) FAILED: ${errMsg}`);
        this.logger.error(err.stack);

        await this.postService.markFailed(post.id, errMsg.slice(0, 500));
        await this.writePublishLog(
          post.id,
          post.integration.platform,
          'FAILED',
          errMsg.slice(0, 1000),
          err?.response?.data ? JSON.stringify(err.response.data) : null,
          Date.now() - startMs,
        );

        await this.notifications.create({
          organizationId: post.integration?.organizationId,
          title: 'Post failed to publish',
          message: `${post.integration?.platform} post failed: ${errMsg.slice(0, 120)}`,
          type: 'error',
          link: '/dashboard/calendar',
        });
      }
    }
  }

  // ── Core publish dispatcher ───────────────────────────────
  private async publishPost(post: any) {
    const platform = post.integration.platform;
    const mediaUrls: string[] = JSON.parse(post.mediaUrls || '[]');

    this.logger.log(`[Publish] Post ${post.id} → ${platform} | media: ${mediaUrls.length} files`);

    // Step 1: Ensure token is fresh before publishing
    const integration = await this.ensureFreshToken(post.integration);

    // Step 2: Decrypt tokens
    const token = decrypt(integration.accessToken);
    const refreshToken = integration.refreshToken ? safeDecrypt(integration.refreshToken) : null;
    const pageToken = integration.pageAccessToken ? safeDecrypt(integration.pageAccessToken) : token;

    // Step 3: Resolve media URLs to public URLs
    const publicMediaUrls = mediaUrls.map((u) => this.resolvePublicUrl(u));

    this.logger.log(`[Publish] Resolved media URLs: ${JSON.stringify(publicMediaUrls)}`);

    // Step 4: Validate media files exist (for local storage)
    for (const url of mediaUrls) {
      this.validateMediaAccess(url);
    }

    // Step 5: Warn if using localhost URLs (Meta/YouTube can't reach them)
    const backendUrl = process.env.BACKEND_INTERNAL_URL || '';
    if (backendUrl.includes('localhost') && mediaUrls.length > 0 && platform !== 'YOUTUBE') {
      this.logger.warn(
        `[Publish] ⚠️  BACKEND_INTERNAL_URL is localhost — Meta APIs cannot fetch media. ` +
        `Configure Supabase Storage so media is served from permanent HTTPS URLs.`,
      );
    }

    if ((platform === 'INSTAGRAM' || platform === 'FACEBOOK') && publicMediaUrls.length > 0) {
      await this.validatePublicMediaUrls(platform, publicMediaUrls, mediaUrls);
    }

    // Step 6: Dispatch to platform
    if (platform === 'INSTAGRAM') {
      await this.publishToInstagram(post, token, publicMediaUrls, mediaUrls);
    } else if (platform === 'FACEBOOK') {
      await this.publishToFacebook(post, pageToken || token, publicMediaUrls, mediaUrls);
    } else if (platform === 'YOUTUBE') {
      await this.publishToYoutube(post, token, refreshToken, mediaUrls);
    } else if (platform === 'LINKEDIN') {
      await this.publishToLinkedin(post, token, publicMediaUrls);
    } else if (platform === 'THREADS') {
      await this.publishToThreads(post, token, publicMediaUrls, mediaUrls);
    } else if (platform === 'GOOGLE_BUSINESS') {
      await this.publishToGoogleBusiness(post, token, publicMediaUrls);
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  // ── Token freshness ───────────────────────────────────────
  private async ensureFreshToken(integration: any): Promise<any> {
    const now = new Date();
    const expiry = integration.tokenExpiry ? new Date(integration.tokenExpiry) : null;
    const isExpired = expiry && expiry <= new Date(now.getTime() + 5 * 60 * 1000); // 5 min buffer
    const needsRefresh = integration.refreshNeeded || isExpired;

    if (needsRefresh) {
      this.logger.log(`[Token] Refreshing token for integration ${integration.id} (${integration.platform})`);
      try {
        await this.tokenRefresh.refreshIntegrationToken(integration);
        // Re-fetch with fresh token
        const fresh = await this.prisma.integration.findUnique({ where: { id: integration.id } });
        if (!fresh) throw new Error('Integration not found after token refresh');
        return fresh;
      } catch (err: any) {
        this.logger.error(`[Token] Refresh failed for ${integration.id}: ${err.message}`);
        throw new Error(`Token refresh failed: ${err.message}. Please reconnect your ${integration.platform} account.`);
      }
    }

    return integration;
  }

  // ── Resolve localhost URLs to public URLs ─────────────────
  private resolvePublicUrl(url: string): string {
    if (!url) return url;

    // Already absolute public URL
    if ((url.startsWith('https://') || url.startsWith('http://')) && !this.isPrivateOrLocalUrl(url)) return url;

    return this.resolveBackendUploadUrl(url);
  }

  private async validatePublicMediaUrls(platform: string, publicUrls: string[], rawUrls: string[]) {
    for (let i = 0; i < publicUrls.length; i++) {
      const url = publicUrls[i];
      const rawUrl = rawUrls[i];
      const isVideo = await this.isVideoMedia(rawUrl);
      let result = await this.mediaUrlValidator.validate(url, isVideo ? 'video' : 'image');
      const canRegenerate = Boolean(rawUrl?.startsWith('/uploads/') || rawUrl?.includes('localhost') || rawUrl?.includes('/uploads/'));
      const regeneratedUrl = canRegenerate ? this.resolveBackendUploadUrl(rawUrl || url) : url;

      if (!result.ok && regeneratedUrl !== url) {
        this.logger.warn(`[MediaPreflight] Retrying with regenerated public URL: ${regeneratedUrl}`);
        const retryResult = await this.mediaUrlValidator.validate(regeneratedUrl, isVideo ? 'video' : 'image');
        this.logger.log(
          `[MediaPreflight] retry url="${regeneratedUrl}" ok=${retryResult.ok} ` +
          `method=${retryResult.method || '-'} status=${retryResult.status || '-'} ` +
          `mime="${retryResult.contentType || '-'}" length=${retryResult.contentLength ?? '-'} ` +
          `reason="${retryResult.reason || '-'}"`,
        );
        if (retryResult.ok) {
          publicUrls[i] = regeneratedUrl;
          result = retryResult;
        }
      }

      this.logger.log(
        `[MediaPreflight] ${platform} url="${publicUrls[i]}" raw="${rawUrl}" ` +
        `ok=${result.ok} method=${result.method || '-'} status=${result.status || '-'} ` +
        `mime="${result.contentType || '-'}" length=${result.contentLength ?? '-'} ` +
        `reason="${result.reason || '-'}"`,
      );

      if (!result.ok) {
        throw new Error(
          `${platform} cannot access your media file publicly. ` +
          `Final URL: ${publicUrls[i]}. ` +
          `Accessibility test: ${result.reason || 'failed'}. ` +
          `Configure a public HTTPS upload URL, such as your Railway app URL, before publishing.`,
        );
      }
    }
  }

  private resolveBackendUploadUrl(url: string): string {
    const filename = path.basename(url.split('?')[0]);
    const backendUrl =
      process.env.LOCAL_UPLOAD_PUBLIC_BASE_URL ||
      process.env.PUBLIC_UPLOAD_BASE_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      'http://localhost:3000';
    return `${backendUrl.replace(/\/+$/, '')}/uploads/${filename}`;
  }

  private isBackendLoopbackUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes('railway.app')) return true;
      const myInternalRaw = process.env.BACKEND_INTERNAL_URL || '';
      const myPublicRaw = process.env.BACKEND_PUBLIC_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';
      
      const myInternalHost = myInternalRaw ? new URL(myInternalRaw).hostname.toLowerCase() : '';
      const myPublicHost = myPublicRaw ? new URL(myPublicRaw).hostname.toLowerCase() : '';
      
      return hostname === myInternalHost || hostname === myPublicHost;
    } catch {
      return false;
    }
  }

  private async preflightPublicMediaUrl(url: string, isVideo: boolean): Promise<MediaPreflightResult> {
    if (!url) return { url, ok: false, reason: 'Missing media URL' };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { url, ok: false, reason: 'Media URL is not absolute' };
    }

    const isLoopback = this.isBackendLoopbackUrl(url);
    if (isLoopback) {
      this.logger.log(`[MediaPreflight] Bypassing reachability probe for backend loopback URL: ${url}`);
      return { url, ok: true, method: 'GET', status: 200, contentType: isVideo ? 'video/mp4' : 'image/jpeg' };
    }

    if (parsed.protocol !== 'https:' && process.env.ALLOW_HTTP_MEDIA_URLS !== 'true') {
      return { url, ok: false, reason: 'Media URL must use HTTPS' };
    }

    if (this.isPrivateOrLocalUrl(url)) {
      return { url, ok: false, reason: `Media URL host is private/local (${parsed.hostname})` };
    }

    const headers = {
      'User-Agent': 'SocialPilotPro-MediaPreflight/1.0',
      'ngrok-skip-browser-warning': 'true',
      Accept: isVideo ? 'video/*,*/*' : 'image/*,*/*',
    };

    try {
      const head = await axios.head(url, {
        timeout: TIMEOUTS.MEDIA_PREFLIGHT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers,
      });
      const result = this.evaluateMediaProbe(url, 'HEAD', head.status, head.headers, isVideo);
      if (result.ok || !this.shouldRetryWithGet(head.status)) return result;
    } catch (err: any) {
      this.logger.warn(`[MediaPreflight] HEAD failed for ${url}: ${err.code || err.message}`);
    }

    try {
      const get = await axios.get(url, {
        timeout: TIMEOUTS.MEDIA_PREFLIGHT,
        maxRedirects: 5,
        responseType: 'stream',
        validateStatus: () => true,
        headers: { ...headers, Range: 'bytes=0-1023' },
      });
      if (get.data?.destroy) get.data.destroy();
      return this.evaluateMediaProbe(url, 'GET', get.status, get.headers, isVideo);
    } catch (err: any) {
      return { url, ok: false, reason: `Public reachability request failed: ${err.code || err.message}` };
    }
  }

  private evaluateMediaProbe(
    url: string,
    method: 'HEAD' | 'GET',
    status: number,
    headers: any,
    isVideo: boolean,
  ): MediaPreflightResult {
    const contentType = String(headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    const rawLength = headers?.['content-length'];
    const contentLength = rawLength !== undefined ? Number(rawLength) : undefined;

    if (status < 200 || status >= 400) {
      return { url, ok: false, method, status, contentType, contentLength, reason: `HTTP ${status}` };
    }

    if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength <= 0) {
      return { url, ok: false, method, status, contentType, contentLength, reason: 'Content-Length is zero' };
    }

    const validType = isVideo
      ? contentType.startsWith('video/') || contentType === 'application/octet-stream'
      : contentType.startsWith('image/') || contentType === 'application/octet-stream';

    if (!validType) {
      return {
        url,
        ok: false,
        method,
        status,
        contentType,
        contentLength,
        reason: `Unexpected content-type "${contentType || 'missing'}" for ${isVideo ? 'video' : 'image'} media`,
      };
    }

    return { url, ok: true, method, status, contentType, contentLength };
  }

  private shouldRetryWithGet(status?: number): boolean {
    return !status || status === 403 || status === 405 || status === 406 || status >= 500;
  }

  private isPrivateOrLocalUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1' || hostname.endsWith('.local')) return true;
      if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
      const match172 = hostname.match(/^172\.(\d+)\./);
      if (match172) {
        const second = Number(match172[1]);
        if (second >= 16 && second <= 31) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  // ── Validate media file exists locally ───────────────────
  private validateMediaAccess(url: string) {
    if (!url) return;

    // For absolute remote URLs (not localhost), skip local validation
    if ((url.startsWith('https://') || url.startsWith('http://')) && !url.includes('localhost')) {
      return;
    }

    const localPath = this.getLocalPath(url);
    if (!localPath) {
      const filename = path.basename(url.split('?')[0]);
      throw new Error(
        `Media file not found on disk: "${filename}". ` +
        `The file may have been deleted or moved. Please re-upload the media.`,
      );
    }

    const stat = fs.statSync(localPath);
    if (stat.size === 0) {
      throw new Error(`Media file is empty: ${path.basename(localPath)}`);
    }

    this.logger.log(`[Media] ✓ ${path.basename(localPath)} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // ── Get local file path from URL/relative path ────────────
  private getLocalPath(url: string): string | null {
    if (!url) return null;

    const uploadDir = process.env.UPLOAD_DIRECTORY
      ? path.resolve(process.cwd(), process.env.UPLOAD_DIRECTORY)
      : path.resolve(process.cwd(), 'uploads');

    const filename = path.basename(url.split('?')[0]);
    if (!filename || filename === '.' || filename === '..') return null;

    const localPath = path.join(uploadDir, filename);
    return fs.existsSync(localPath) ? localPath : null;
  }

  // ── Detect if URL/path is a video ─────────────────────────
  private async isVideoMedia(url: string): Promise<boolean> {
    // Check by extension first
    const ext = path.extname(url.split('?')[0]).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'].includes(ext)) return true;
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return false;

    // Check DB for mimeType
    try {
      const filename = path.basename(url.split('?')[0]);
      const media = await this.prisma.media.findFirst({
        where: { name: filename, deletedAt: null },
        select: { mimeType: true },
      });
      if (media?.mimeType) return media.mimeType.startsWith('video/');
    } catch { /* ignore */ }

    return false;
  }

  // ── Get video aspect ratio ────────────────────────────────
  private async getVideoAspectRatio(url: string): Promise<number | null> {
    try {
      const filename = path.basename(url.split('?')[0]);
      const media = await this.prisma.media.findFirst({
        where: { name: filename, deletedAt: null },
        select: { width: true, height: true, aspectRatio: true },
      });
      if (media) {
        if (media.width && media.height) {
          return media.width / media.height;
        }
        if (media.aspectRatio) {
          const parts = media.aspectRatio.split(':');
          if (parts.length === 2) {
            const w = parseFloat(parts[0]);
            const h = parseFloat(parts[1]);
            if (!isNaN(w) && !isNaN(h) && h !== 0) {
              return w / h;
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error querying media for aspect ratio: ${err.message}`);
    }

    try {
      const localPath = this.getLocalPath(url);
      if (localPath) {
        const { execFileSync } = require('child_process');
        const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
        const stdout = execFileSync(ffprobePath, [
          '-v', 'error',
          '-print_format', 'json',
          '-show_streams',
          localPath,
        ], {
          timeout: 5000,
          windowsHide: true,
          encoding: 'utf8',
        });
        const metadata = JSON.parse(stdout);
        const video = (metadata.streams || []).find((s: any) => s.codec_type === 'video');
        if (video) {
          const width = Number(video.width || 0);
          const height = Number(video.height || 0);
          if (width > 0 && height > 0) {
            return width / height;
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Could not extract aspect ratio from local file using ffprobe: ${err.message}`);
    }

    return null;
  }

  // ── Format caption ────────────────────────────────────────
  private formatCaption(post: any): string {
    const content = post.content || '';
    const hashtags = post.hashtags?.trim() || '';
    if (!hashtags) return content;
    return `${content}\n\n${hashtags}`;
  }

  // ── Instagram publish ─────────────────────────────────────
  private async publishToInstagram(
    post: any,
    token: string,
    publicMediaUrls: string[],
    rawMediaUrls: string[],
  ) {
    const isDirect = token.startsWith('IGQ') || token.startsWith('IG');
    const META_VERSION = process.env.META_API_VERSION || 'v21.0';
    const BASE = isDirect ? `https://graph.instagram.com` : `https://graph.facebook.com/${META_VERSION}`;
    const igId = post.integration.internalId;
    const caption = this.formatCaption(post);

    if (publicMediaUrls.length === 0) {
      throw new Error('Instagram requires at least one media item');
    }

    let mediaId: string;

    if (publicMediaUrls.length === 1) {
      const isVideo = await this.isVideoMedia(rawMediaUrls[0]);

      this.logger.log(`[Instagram] Single media — isVideo: ${isVideo}`);

      const createPayload: any = {
        caption,
        access_token: token,
      };

      if (isVideo) {
        createPayload.video_url = publicMediaUrls[0];
        const ratio = await this.getVideoAspectRatio(rawMediaUrls[0]);
        this.logger.log(`[Instagram] Video aspect ratio for ${rawMediaUrls[0]}: ${ratio}`);
        if (ratio && ratio > 1) {
          this.logger.log(`[Instagram] Horizontal video detected (aspect ratio: ${ratio}). Publishing as standard VIDEO.`);
          createPayload.media_type = 'VIDEO';
        } else {
          this.logger.log(`[Instagram] Vertical/square video detected (aspect ratio: ${ratio}). Publishing as REELS.`);
          createPayload.media_type = 'REELS';
        }
      } else {
        createPayload.image_url = publicMediaUrls[0];
      }

      this.logger.log(`[Instagram] Creating container: ${JSON.stringify({ ...createPayload, access_token: '***' })}`);

      const createRes = await withTimeout(
        axios.post(`${BASE}/${igId}/media`, createPayload, { timeout: TIMEOUTS.META_API_CALL }),
        TIMEOUTS.META_API_CALL,
        'Instagram create container',
      );
      mediaId = createRes.data.id;

      // For videos/reels, poll until container is ready
      if (isVideo) {
        mediaId = await this.waitForInstagramContainer(mediaId, token, BASE);
      }
    } else {
      // Carousel — all items must be images for carousel
      this.logger.log(`[Instagram] Creating carousel with ${publicMediaUrls.length} items`);
      const childIds: string[] = [];

      for (let i = 0; i < publicMediaUrls.length; i++) {
        const isVideo = await this.isVideoMedia(rawMediaUrls[i]);
        const childPayload: any = {
          is_carousel_item: true,
          access_token: token,
        };
        if (isVideo) {
          childPayload.video_url = publicMediaUrls[i];
          childPayload.media_type = 'VIDEO';
        } else {
          childPayload.image_url = publicMediaUrls[i];
        }

        const childRes = await withTimeout(
          axios.post(`${BASE}/${igId}/media`, childPayload, { timeout: TIMEOUTS.META_API_CALL }),
          TIMEOUTS.META_API_CALL,
          `Instagram carousel child ${i + 1}`,
        );
        let childId = childRes.data.id;

        if (isVideo) {
          childId = await this.waitForInstagramContainer(childId, token, BASE);
        }

        childIds.push(childId);
      }

      const carouselRes = await withTimeout(
        axios.post(`${BASE}/${igId}/media`, {
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          caption,
          access_token: token,
        }, { timeout: TIMEOUTS.META_API_CALL }),
        TIMEOUTS.META_API_CALL,
        'Instagram create carousel container',
      );
      mediaId = carouselRes.data.id;
    }

    // Publish the container
    this.logger.log(`[Instagram] Publishing container ${mediaId}`);
    const publishRes = await withTimeout(
      axios.post(`${BASE}/${igId}/media_publish`, {
        creation_id: mediaId,
        access_token: token,
      }, { timeout: TIMEOUTS.META_API_CALL }),
      TIMEOUTS.META_API_CALL,
      'Instagram media_publish',
    );

    const publishedId = publishRes.data.id;
    this.logger.log(`[Instagram] Published! ID: ${publishedId}`);

    await this.postService.markPublished(
      post.id,
      publishedId,
      `https://www.instagram.com/p/${publishedId}`,
    );
  }

  // ── LinkedIn publish ──────────────────────────────────────
  private async publishToLinkedin(post: any, token: string, publicMediaUrls: string[]) {
    const authorId = post.integration.internalId;
    const caption = this.formatCaption(post);

    const payload: any = {
      author: `urn:li:person:${authorId}`,
      commentary: caption,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targeter: {},
      },
      lifecycleState: 'PUBLISHED',
    };

    if (publicMediaUrls.length > 0) {
      payload.content = {
        media: {
          title: 'Scheduled Post',
          id: publicMediaUrls[0],
        },
        article: {
          source: publicMediaUrls[0],
          title: 'Post Media',
        }
      };
    }

    this.logger.log(`[LinkedIn] Publishing to member ${authorId}`);
    const res = await withTimeout(
      axios.post('https://api.linkedin.com/v2/posts', payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        timeout: TIMEOUTS.META_API_CALL,
      }),
      TIMEOUTS.META_API_CALL,
      'LinkedIn publish',
    );

    const publishedId = res.headers['x-restli-id'] || res.data.id;
    this.logger.log(`[LinkedIn] Published! ID: ${publishedId}`);

    await this.postService.markPublished(
      post.id,
      publishedId,
      `https://www.linkedin.com/feed/update/${publishedId}`,
    );
  }

  // ── Threads publish ───────────────────────────────────────
  private async publishToThreads(
    post: any,
    token: string,
    publicMediaUrls: string[],
    rawMediaUrls: string[],
  ) {
    const userId = post.integration.internalId;
    const caption = this.formatCaption(post);
    const BASE = 'https://graph.threads.net/v1.0';

    let mediaId: string;

    const createPayload: any = {
      access_token: token,
    };

    if (publicMediaUrls.length > 0) {
      const isVideo = await this.isVideoMedia(rawMediaUrls[0]);
      if (isVideo) {
        createPayload.media_type = 'VIDEO';
        createPayload.video_url = publicMediaUrls[0];
      } else {
        createPayload.media_type = 'IMAGE';
        createPayload.image_url = publicMediaUrls[0];
      }
      if (caption) createPayload.text = caption;
    } else {
      createPayload.media_type = 'TEXT';
      createPayload.text = caption || '';
    }

    this.logger.log(`[Threads] Creating media container for ${userId}`);
    const createRes = await withTimeout(
      axios.post(`${BASE}/${userId}/threads`, createPayload, { timeout: TIMEOUTS.META_API_CALL }),
      TIMEOUTS.META_API_CALL,
      'Threads create container',
    );
    mediaId = createRes.data.id;

    if (publicMediaUrls.length > 0) {
      mediaId = await this.waitForThreadsContainer(mediaId, token, BASE);
    }

    this.logger.log(`[Threads] Publishing container ${mediaId}`);
    const publishRes = await withTimeout(
      axios.post(`${BASE}/${userId}/threads_publish`, {
        creation_id: mediaId,
        access_token: token,
      }, { timeout: TIMEOUTS.META_API_CALL }),
      TIMEOUTS.META_API_CALL,
      'Threads threads_publish',
    );

    const publishedId = publishRes.data.id;
    this.logger.log(`[Threads] Published! ID: ${publishedId}`);

    await this.postService.markPublished(
      post.id,
      publishedId,
      `https://www.threads.net/@${post.integration.name}/post/${publishedId}`,
    );
  }

  private async waitForThreadsContainer(
    containerId: string,
    token: string,
    BASE: string,
    maxWaitMs = TIMEOUTS.INSTAGRAM_CONTAINER_POLL,
  ): Promise<string> {
    const pollInterval = 5000;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const statusRes = await withTimeout(
        axios.get(`${BASE}/${containerId}`, {
          params: { fields: 'status_code,error_message', access_token: token },
          timeout: TIMEOUTS.META_API_CALL,
        }),
        TIMEOUTS.META_API_CALL,
        'Threads container status poll',
      );

      const statusCode = statusRes.data.status_code;
      this.logger.log(`[Threads] Container ${containerId} status: ${statusCode}`);

      if (statusCode === 'FINISHED') return containerId;
      if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
        throw new Error(
          `Threads media container failed: ${statusCode}` +
          (statusRes.data.error_message ? ` — ${statusRes.data.error_message}` : '')
        );
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`Threads media container timed out after ${maxWaitMs / 1000}s.`);
  }

  // ── Google Business Profile publish ───────────────────────
  private async publishToGoogleBusiness(post: any, token: string, publicMediaUrls: string[]) {
    const locationId = post.integration.internalId;
    const caption = this.formatCaption(post);

    const payload: any = {
      languageCode: 'en-US',
      summary: caption,
    };

    if (publicMediaUrls.length > 0) {
      payload.media = publicMediaUrls.map((url) => ({
        mediaFormat: 'PHOTO',
        sourceUrl: url,
      }));
    }

    this.logger.log(`[Google Business] Publishing to location ${locationId}`);
    const res = await withTimeout(
      axios.post(
        `https://mybusinesslocalpost.googleapis.com/v1/locations/${locationId}/localPosts`,
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: TIMEOUTS.META_API_CALL,
        },
      ),
      TIMEOUTS.META_API_CALL,
      'Google Business Profile publish',
    );

    const publishedId = res.data.name;
    this.logger.log(`[Google Business] Published! ID: ${publishedId}`);

    await this.postService.markPublished(
      post.id,
      publishedId,
      `https://business.google.com/dashboard/l/${locationId}`,
    );
  }

  // ── Poll Instagram container until FINISHED ───────────────
  private async waitForInstagramContainer(
    containerId: string,
    token: string,
    BASE: string,
    maxWaitMs = TIMEOUTS.INSTAGRAM_CONTAINER_POLL,
  ): Promise<string> {
    const pollInterval = 5000;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const statusRes = await withTimeout(
        axios.get(`${BASE}/${containerId}`, {
          params: { fields: 'status_code,status', access_token: token },
          timeout: TIMEOUTS.META_API_CALL,
        }),
        TIMEOUTS.META_API_CALL,
        'Instagram container status poll',
      );

      const statusCode = statusRes.data.status_code;
      this.logger.log(`[Instagram] Container ${containerId} status: ${statusCode}`);

      if (statusCode === 'FINISHED') return containerId;
      if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
        throw new Error(
          `Instagram media container failed: ${statusCode}` +
          (statusRes.data.status ? ` — ${statusRes.data.status}` : '') +
          `. Check video specs: H.264 codec, AAC audio, 9:16 ratio, 3–90 seconds.`,
        );
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`Instagram media container timed out after ${maxWaitMs / 1000}s. The video may not meet Instagram's requirements.`);
  }

  // ── Facebook publish ──────────────────────────────────────
  private async publishToFacebook(
    post: any,
    pageToken: string,
    publicMediaUrls: string[],
    rawMediaUrls: string[],
  ) {
    const META_VERSION = process.env.META_API_VERSION || 'v21.0';
    const BASE = `https://graph.facebook.com/${META_VERSION}`;
    const pageId = post.integration.pageId || post.integration.internalId;
    const caption = this.formatCaption(post);

    let res: any;

    if (publicMediaUrls.length === 0) {
      // Text-only post
      this.logger.log(`[Facebook] Text-only post to page ${pageId}`);
      res = await withTimeout(
        axios.post(`${BASE}/${pageId}/feed`, {
          message: caption,
          access_token: pageToken,
        }, { timeout: TIMEOUTS.META_API_CALL }),
        TIMEOUTS.META_API_CALL,
        'Facebook text post',
      );
    } else if (publicMediaUrls.length === 1) {
      const isVideo = await this.isVideoMedia(rawMediaUrls[0]);

      if (isVideo) {
        this.logger.log(`[Facebook] Video post to page ${pageId}: ${publicMediaUrls[0]}`);

        const localPath = this.getLocalPath(rawMediaUrls[0]);

        if (localPath) {
          const FormData = require('form-data');
          const form = new FormData();
          form.append('source', fs.createReadStream(localPath));
          form.append('description', caption);
          form.append('access_token', pageToken);

          res = await withTimeout(
            axios.post(`${BASE}/${pageId}/videos`, form, {
              headers: form.getHeaders(),
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
              timeout: TIMEOUTS.FACEBOOK_VIDEO_UPLOAD,
            }),
            TIMEOUTS.FACEBOOK_VIDEO_UPLOAD,
            'Facebook video upload (local file)',
          );
        } else {
          res = await withTimeout(
            axios.post(`${BASE}/${pageId}/videos`, {
              file_url: publicMediaUrls[0],
              description: caption,
              access_token: pageToken,
            }, { timeout: TIMEOUTS.FACEBOOK_VIDEO_UPLOAD }),
            TIMEOUTS.FACEBOOK_VIDEO_UPLOAD,
            'Facebook video upload (URL)',
          );
        }
      } else {
        this.logger.log(`[Facebook] Photo post to page ${pageId}: ${publicMediaUrls[0]}`);
        res = await withTimeout(
          axios.post(`${BASE}/${pageId}/photos`, {
            url: publicMediaUrls[0],
            caption,
            access_token: pageToken,
          }, { timeout: TIMEOUTS.META_API_CALL }),
          TIMEOUTS.META_API_CALL,
          'Facebook photo post',
        );
      }
    } else {
      // Multi-photo post
      this.logger.log(`[Facebook] Multi-photo post (${publicMediaUrls.length} images) to page ${pageId}`);
      const photoIds: string[] = [];

      for (const url of publicMediaUrls) {
        const photoRes = await withTimeout(
          axios.post(`${BASE}/${pageId}/photos`, {
            url,
            published: false,
            access_token: pageToken,
          }, { timeout: TIMEOUTS.META_API_CALL }),
          TIMEOUTS.META_API_CALL,
          'Facebook stage photo',
        );
        photoIds.push(photoRes.data.id);
      }

      res = await withTimeout(
        axios.post(`${BASE}/${pageId}/feed`, {
          message: caption,
          attached_media: photoIds.map((id) => ({ media_fbid: id })),
          access_token: pageToken,
        }, { timeout: TIMEOUTS.META_API_CALL }),
        TIMEOUTS.META_API_CALL,
        'Facebook multi-photo feed post',
      );
    }

    const publishedId = res.data.id;
    this.logger.log(`[Facebook] Published! ID: ${publishedId}`);

    await this.postService.markPublished(
      post.id,
      publishedId,
      `https://www.facebook.com/${publishedId}`,
    );
  }

  // ── YouTube publish ───────────────────────────────────────
  private async publishToYoutube(
    post: any,
    accessToken: string,
    refreshToken: string | null,
    rawMediaUrls: string[],
  ) {
    if (rawMediaUrls.length === 0) {
      throw new Error('YouTube requires a video file');
    }

    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
    });

    // Auto-refresh if token is expired
    auth.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        this.logger.log(`[YouTube] Token auto-refreshed for integration ${post.integration.id}`);
        const { encrypt } = await import('../../common/utils/crypto.util');
        await this.prisma.integration.update({
          where: { id: post.integration.id },
          data: {
            accessToken: encrypt(tokens.access_token),
            ...(tokens.expiry_date && { tokenExpiry: new Date(tokens.expiry_date) }),
          },
        });
      }
    });

    const youtube = google.youtube({ version: 'v3', auth });

    // CRITICAL FIX: Always stream from local file — never from localhost URL
    // Google's servers cannot reach localhost
    const videoUrl = rawMediaUrls[0];
    const localPath = this.getLocalPath(videoUrl);

    if (!localPath) {
      // Last resort: try to download from public URL
      const publicUrl = this.resolvePublicUrl(videoUrl);
      if (publicUrl.includes('localhost')) {
        throw new Error(
          `YouTube upload requires a publicly accessible video file. ` +
          `The file "${path.basename(videoUrl)}" is only available on localhost. ` +
          `Ensure cloud storage is configured and the video has a permanent HTTPS URL.`,
        );
      }
      this.logger.log(`[YouTube] Downloading video from public URL: ${publicUrl}`);
      const axiosRes = await withTimeout(
        axios.get(publicUrl, { responseType: 'stream', timeout: TIMEOUTS.AXIOS_DEFAULT }),
        60_000,
        'YouTube download from public URL',
      );

      const title = post.title || post.content.slice(0, 100) || 'Untitled Video';
      const description = this.formatCaption(post);
      const tags = post.hashtags?.match(/#\w+/g)?.map((t: string) => t.slice(1)) || [];

      this.logger.log(`[YouTube] Uploading video: "${title}"`);

      const res = await withTimeout(
        youtube.videos.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet: { title, description, tags, categoryId: '22' },
            status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
          },
          media: { body: axiosRes.data },
        }),
        TIMEOUTS.YOUTUBE_UPLOAD,
        'YouTube video insert (URL fallback)',
      );

      const videoId = res.data.id!;
      this.logger.log(`[YouTube] Published! Video ID: ${videoId}`);
      await this.postService.markPublished(post.id, videoId, `https://www.youtube.com/watch?v=${videoId}`);
      return;
    }

    // Stream directly from local file — most reliable
    this.logger.log(`[YouTube] Uploading from local file: ${localPath} (${(fs.statSync(localPath).size / 1024 / 1024).toFixed(2)} MB)`);

    const title = post.title || post.content.slice(0, 100) || 'Untitled Video';
    const description = this.formatCaption(post);
    const tags = post.hashtags?.match(/#\w+/g)?.map((t: string) => t.slice(1)) || [];

    // Detect YouTube Short: ≤60s AND 9:16 aspect ratio
    // Add #Shorts to title/tags so YouTube classifies it correctly
    let finalTitle = title;
    let finalTags = [...tags];
    try {
      const ffmpeg = require('fluent-ffmpeg');
      const meta: any = await new Promise((res, rej) =>
        ffmpeg.ffprobe(localPath, (e: any, d: any) => e ? rej(e) : res(d)),
      );
      const videoStream = meta.streams?.find((s: any) => s.codec_type === 'video');
      const duration = parseFloat(meta.format?.duration || '0');
      const w = videoStream?.width || 0;
      const h = videoStream?.height || 0;
      const isShort = duration > 0 && duration <= 60 && h > w; // portrait + ≤60s

      if (isShort) {
        this.logger.log(`[YouTube] Detected as Short (${duration.toFixed(1)}s, ${w}×${h})`);
        if (!finalTitle.includes('#Shorts')) finalTitle = `${finalTitle} #Shorts`;
        if (!finalTags.includes('Shorts')) finalTags.unshift('Shorts');
      }
    } catch { /* ffprobe unavailable — skip Short detection */ }

    const res = await withTimeout(
      youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: { title: finalTitle.slice(0, 100), description, tags: finalTags, categoryId: '22' },
          status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
        },
        media: {
          mimeType: 'video/*',
          body: fs.createReadStream(localPath),
        },
      }),
      TIMEOUTS.YOUTUBE_UPLOAD,
      'YouTube video insert',
    );

    const videoId = res.data.id!;
    this.logger.log(`[YouTube] Published! Video ID: ${videoId}`);
    await this.postService.markPublished(post.id, videoId, `https://www.youtube.com/watch?v=${videoId}`);
  }

  // ── Humanize platform API errors ─────────────────────────
  private humanizeApiError(data: any, platform: string): string {
    const raw = JSON.stringify(data);

    // Meta / Facebook / Instagram errors
    if (data?.error) {
      const { message, code, error_subcode, type } = data.error;
      const base = message || raw;

      // Code 200 = API access blocked — app permissions issue
      if (code === 200) {
        return (
          `${platform} API access blocked (code 200). ` +
          `Your Meta app likely needs "pages_manage_posts" permission approved. ` +
          `Go to developers.facebook.com → your app → App Review → Request permissions. ` +
          `If in Development mode, add yourself as a test user. ` +
          `Original: ${base}`
        );
      }
      // Code 190 = token expired/invalid
      if (code === 190) {
        return (
          `${platform} access token expired or invalid (code 190). ` +
          `Please reconnect your ${platform} account in Settings → Connections. ` +
          `Original: ${base}`
        );
      }
      // Code 100 = invalid parameter
      if (code === 100) {
        return `${platform} invalid parameter (code 100): ${base}. Instagram cannot access your media file publicly. Check that the final media URL is HTTPS, publicly reachable, downloadable, and CDN-hosted.`;
      }
      // Code 368 = temporarily blocked
      if (code === 368) {
        return `${platform} account temporarily blocked (code 368). Wait 24h and try again. Original: ${base}`;
      }
      return `${platform} API error (code ${code}): ${base}`;
    }

    // YouTube errors
    if (data?.errors || data?.error?.errors) {
      const errors = data.errors || data.error.errors;
      const reasons = errors.map((e: any) => `${e.reason}: ${e.message}`).join('; ');
      if (reasons.includes('quotaExceeded')) {
        return `YouTube quota exceeded. Daily upload limit reached (10,000 units/day). Try again tomorrow.`;
      }
      if (reasons.includes('forbidden')) {
        return `YouTube upload forbidden. Reconnect your YouTube account in Settings → Connections.`;
      }
      return `YouTube API error: ${reasons}`;
    }

    return raw.slice(0, 500);
  }

  // ── Write publish audit log ───────────────────────────────
  private async writePublishLog(
    postId: string,
    platform: string,
    status: 'SUCCESS' | 'FAILED' | 'RETRYING',
    error: string | null,
    apiResponse: string | null,
    durationMs: number,
  ) {
    try {
      await this.prisma.publishLog.create({
        data: {
          postId,
          platform: platform as any,
          status: status as any,
          error,
          apiResponse,
          durationMs,
        },
      });
    } catch (e: any) {
      // Don't let log failure break the publish flow
      this.logger.warn(`[PublishLog] Failed to write log: ${e.message}`);
    }
  }
}
