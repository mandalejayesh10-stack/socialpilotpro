import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom throttler that skips rate limiting for internal/health routes.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: any): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // Skip health checks, uploads, and webhook endpoints
    const skip = ['/api/health', '/api/billing/webhook', '/uploads', '/api/uploads'];
    return skip.some((p) => req.url?.startsWith(p) || req.path?.startsWith(p));
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    // Use real IP behind proxies
    const ip =
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers?.['x-real-ip'] ||
      req.ip ||
      'unknown';
    return Promise.resolve(ip);
  }
}
