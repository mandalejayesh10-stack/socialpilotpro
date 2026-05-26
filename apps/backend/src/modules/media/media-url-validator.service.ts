import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type MediaUrlValidationResult = {
  url: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  method?: 'HEAD' | 'GET';
  reason?: string;
  publishSafe: boolean;
};

@Injectable()
export class MediaUrlValidatorService {
  private readonly logger = new Logger(MediaUrlValidatorService.name);
  private readonly timeoutMs = Number(process.env.MEDIA_URL_PREFLIGHT_TIMEOUT_MS || 15_000);

  isPrivateOrLocalUrl(url: string): boolean {
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

  async validate(url: string, mediaKind: 'image' | 'video' | 'audio' | 'any' = 'any'): Promise<MediaUrlValidationResult> {
    if (!url) return this.fail(url, 'Missing media URL');

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return this.fail(url, 'Media URL is not absolute');
    }

    if (parsed.protocol !== 'https:' && process.env.ALLOW_HTTP_MEDIA_URLS !== 'true') {
      return this.fail(url, 'Media URL must use HTTPS');
    }

    if (this.isPrivateOrLocalUrl(url)) {
      return this.fail(url, `Media URL host is private/local (${parsed.hostname})`);
    }

    const headers = {
      'User-Agent': 'SocialPilotPro-MediaPreflight/1.0',
      'ngrok-skip-browser-warning': 'true',
      Accept: this.acceptHeader(mediaKind),
    };

    try {
      const head = await axios.head(url, {
        timeout: this.timeoutMs,
        maxRedirects: 5,
        validateStatus: () => true,
        headers,
      });
      const result = this.evaluate(url, 'HEAD', head.status, head.headers, mediaKind);
      if (result.ok || !this.shouldRetryWithGet(head.status)) return result;
    } catch (err: any) {
      this.logger.warn(`HEAD failed for ${url}: ${err.code || err.message}`);
    }

    try {
      const get = await axios.get(url, {
        timeout: this.timeoutMs,
        maxRedirects: 5,
        responseType: 'stream',
        validateStatus: () => true,
        headers: { ...headers, Range: 'bytes=0-1023' },
      });
      if (get.data?.destroy) get.data.destroy();
      return this.evaluate(url, 'GET', get.status, get.headers, mediaKind);
    } catch (err: any) {
      return this.fail(url, `Public reachability request failed: ${err.code || err.message}`);
    }
  }

  private evaluate(url: string, method: 'HEAD' | 'GET', status: number, headers: any, mediaKind: string): MediaUrlValidationResult {
    const contentType = String(headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    const rawLength = headers?.['content-length'];
    const contentLength = rawLength !== undefined ? Number(rawLength) : undefined;

    if (status < 200 || status >= 400) {
      return this.fail(url, `HTTP ${status}`, { method, status, contentType, contentLength });
    }
    if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength <= 0) {
      return this.fail(url, 'Content-Length is zero', { method, status, contentType, contentLength });
    }

    const validType =
      mediaKind === 'any' ||
      contentType === 'application/octet-stream' ||
      contentType.startsWith(`${mediaKind}/`);

    if (!validType) {
      return this.fail(url, `Unexpected content-type "${contentType || 'missing'}" for ${mediaKind} media`, {
        method,
        status,
        contentType,
        contentLength,
      });
    }

    return { url, ok: true, publishSafe: true, method, status, contentType, contentLength };
  }

  private acceptHeader(mediaKind: string): string {
    if (mediaKind === 'image') return 'image/*,*/*';
    if (mediaKind === 'video') return 'video/*,*/*';
    if (mediaKind === 'audio') return 'audio/*,*/*';
    return '*/*';
  }

  private shouldRetryWithGet(status?: number): boolean {
    return !status || status === 403 || status === 405 || status === 406 || status >= 500;
  }

  private fail(url: string, reason: string, extra: Partial<MediaUrlValidationResult> = {}): MediaUrlValidationResult {
    return { url, ok: false, publishSafe: false, reason, ...extra };
  }
}
