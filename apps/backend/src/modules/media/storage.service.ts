import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Storage abstraction for publish-safe media URLs.
 *
 * STORAGE_PROVIDER:
 * - local: local /uploads path, suitable only with a live public tunnel/CDN in front of the backend
 * - supabase: Supabase Storage public bucket
 * - s3: AWS S3 public bucket or CDN
 * - r2: Cloudflare R2 S3-compatible bucket with a public custom domain
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  private readonly uploadDir = process.env.UPLOAD_DIRECTORY || './uploads';

  constructor() {
    if (this.provider === 'local' && !fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  getProvider() {
    return this.getActiveProvider();
  }

  isPublishSafeProvider() {
    return ['supabase', 's3', 'r2'].includes(this.getActiveProvider()) || Boolean(this.getLocalPublicBaseUrl());
  }

  getStatus() {
    const activeProvider = this.getActiveProvider();
    return {
      provider: this.provider,
      activeProvider,
      publishSafe: this.isPublishSafeProvider(),
      configured: this.isConfigured(),
      publicBaseUrl: this.getPublicBaseUrl(),
      uploadDir: this.uploadDir,
      message: this.isPublishSafeProvider()
        ? 'Media uploads resolve to public HTTPS URLs for publishing.'
        : 'Local storage is for development previews only until a public HTTPS upload base URL is configured.',
    };
  }

  async upload(filePath: string, filename: string, mimeType: string): Promise<string> {
    const provider = this.getActiveProvider();
    if (provider === 'supabase') {
      return this.uploadToSupabase(filePath, filename, mimeType);
    }
    if (provider === 's3' || provider === 'r2') {
      return this.uploadToS3Compatible(filePath, filename, mimeType);
    }
    return this.uploadToLocal(filePath, filename);
  }

  async healthCheck() {
    const provider = this.getActiveProvider();
    if (provider === 'local') {
      return {
        ...this.getStatus(),
        healthy: fs.existsSync(this.uploadDir),
        reason: fs.existsSync(this.uploadDir) ? undefined : 'Upload directory does not exist',
      };
    }

    return {
      ...this.getStatus(),
      healthy: this.isConfigured(),
      reason: this.isConfigured() ? undefined : `${this.provider.toUpperCase()} environment variables are incomplete`,
    };
  }

  async delete(fileUrl: string): Promise<void> {
    const provider = this.getActiveProvider();
    if (provider === 'supabase') {
      await this.deleteFromSupabase(fileUrl);
      return;
    }
    if (provider === 's3' || provider === 'r2') {
      await this.deleteFromS3Compatible(fileUrl);
      return;
    }

    const filename = path.basename(fileUrl);
    const fullPath = path.join(this.uploadDir, filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  private async uploadToSupabase(filePath: string, filename: string, mimeType: string): Promise<string> {
    const { createClient } = this.requireOptional('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const bucket = process.env.SUPABASE_BUCKET || 'socialpilot-media';
    await this.ensureSupabaseBucket(supabase, bucket);
    const objectKey = this.buildObjectKey(filename, mimeType);

    const { error } = await supabase.storage
      .from(bucket)
      .upload(objectKey, fs.createReadStream(filePath), {
        contentType: mimeType,
        upsert: true,
      });

    if (error) throw new Error(`Supabase upload failed: ${error.message}`);

    const { data } = supabase.storage.from(bucket).getPublicUrl(objectKey);
    return data.publicUrl;
  }

  private uploadToLocal(filePath: string, filename: string): string {
    const target = path.join(this.uploadDir, filename);
    const source = path.resolve(filePath);
    const resolvedTarget = path.resolve(target);
    if (source !== resolvedTarget) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      fs.copyFileSync(source, resolvedTarget);
    }
    const publicBaseUrl = this.getLocalPublicBaseUrl();
    if (publicBaseUrl) return `${publicBaseUrl}/uploads/${encodeURIComponent(filename)}`;
    return `/uploads/${filename}`;
  }

  private async deleteFromSupabase(fileUrl: string): Promise<void> {
    const { createClient } = this.requireOptional('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const bucket = process.env.SUPABASE_BUCKET || 'socialpilot-media';
    const marker = `/storage/v1/object/public/${bucket}/`;
    const objectKey = fileUrl.includes(marker)
      ? decodeURIComponent(fileUrl.split(marker)[1])
      : decodeURIComponent(fileUrl.split('/').pop()!);
    await supabase.storage.from(bucket).remove([objectKey]);
  }

  private async ensureSupabaseBucket(supabase: any, bucket: string) {
    const { data } = await supabase.storage.getBucket(bucket);
    if (data) return;
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: '1024MB',
      allowedMimeTypes: ['image/*', 'video/*', 'audio/*'],
    });
    if (error && !String(error.message || '').toLowerCase().includes('already exists')) {
      throw new Error(`Supabase bucket creation failed: ${error.message}`);
    }
  }

  private buildObjectKey(filename: string, mimeType: string) {
    const prefix = mimeType.startsWith('video/')
      ? 'videos'
      : mimeType.startsWith('image/')
        ? 'images'
        : mimeType.startsWith('audio/')
          ? 'audio'
          : 'files';
    const today = new Date().toISOString().slice(0, 10);
    return `${prefix}/${today}/${filename}`;
  }

  private async uploadToS3Compatible(filePath: string, filename: string, mimeType: string): Promise<string> {
    const { S3Client, PutObjectCommand } = this.requireOptional('@aws-sdk/client-s3');
    const cfg = this.getS3Config();
    const client = new S3Client(cfg.client);

    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: filename,
      Body: fs.createReadStream(filePath),
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return `${cfg.publicBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(filename)}`;
  }

  private async deleteFromS3Compatible(fileUrl: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } = this.requireOptional('@aws-sdk/client-s3');
    const cfg = this.getS3Config();
    const client = new S3Client(cfg.client);
    const filename = decodeURIComponent(fileUrl.split('/').pop() || '');
    if (!filename) return;

    await client.send(new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: filename,
    }));
  }

  private getS3Config() {
    const isR2 = this.provider === 'r2';
    const bucket = isR2 ? process.env.R2_BUCKET : process.env.AWS_S3_BUCKET;
    const publicBaseUrl = isR2
      ? process.env.R2_PUBLIC_URL
      : (process.env.AWS_S3_PUBLIC_URL || process.env.S3_PUBLIC_URL);

    if (!bucket || !publicBaseUrl) {
      throw new Error(
        `${this.provider.toUpperCase()} storage is not configured. ` +
        `Set ${isR2 ? 'R2_BUCKET and R2_PUBLIC_URL' : 'AWS_S3_BUCKET and AWS_S3_PUBLIC_URL'}.`,
      );
    }

    if (isR2) {
      const endpoint = process.env.R2_ENDPOINT || (
        process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''
      );
      if (!endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        throw new Error('R2 storage is not configured. Set R2_ACCOUNT_ID/R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
      }
      return {
        bucket,
        publicBaseUrl,
        client: {
          region: process.env.R2_REGION || 'auto',
          endpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
          },
        },
      };
    }

    if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('S3 storage is not configured. Set AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.');
    }

    return {
      bucket,
      publicBaseUrl,
      client: {
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      },
    };
  }

  private isConfigured(): boolean {
    const provider = this.getActiveProvider();
    if (provider === 'local') return fs.existsSync(this.uploadDir);
    if (provider === 'supabase') {
      return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.SUPABASE_BUCKET || 'socialpilot-media'));
    }
    if (provider === 'r2') {
      return Boolean(
        process.env.R2_BUCKET &&
        process.env.R2_PUBLIC_URL &&
        (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID) &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY,
      );
    }
    if (provider === 's3') {
      return Boolean(
        process.env.AWS_S3_BUCKET &&
        (process.env.AWS_S3_PUBLIC_URL || process.env.S3_PUBLIC_URL) &&
        process.env.AWS_REGION &&
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY,
      );
    }
    return false;
  }

  private getPublicBaseUrl(): string | null {
    const provider = this.getActiveProvider();
    if (provider === 'supabase' && process.env.SUPABASE_URL) {
      const bucket = process.env.SUPABASE_BUCKET || 'socialpilot-media';
      return `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}`;
    }
    if (provider === 'r2') return process.env.R2_PUBLIC_URL || null;
    if (provider === 's3') return process.env.AWS_S3_PUBLIC_URL || process.env.S3_PUBLIC_URL || null;
    if (provider === 'local') return this.getLocalPublicBaseUrl();
    return null;
  }

  private getLocalPublicBaseUrl(): string | null {
    const raw =
      process.env.LOCAL_UPLOAD_PUBLIC_BASE_URL ||
      process.env.PUBLIC_UPLOAD_BASE_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      '';
    const base = raw.replace(/\/+$/, '');
    if (!base.startsWith('https://')) return null;
    try {
      const parsed = new URL(base);
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '0.0.0.0' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.endsWith('.local')
      ) return null;
      return base;
    } catch {
      return null;
    }
  }

  private getActiveProvider() {
    if (
      this.provider === 'local' &&
      process.env.AUTO_CLOUD_MIGRATION !== 'false' &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return 'supabase';
    }
    return this.provider;
  }

  private requireOptional(packageName: string): any {
    try {
      const req = eval('require');
      return req(packageName);
    } catch {
      throw new Error(
        `${packageName} is required for STORAGE_PROVIDER=${this.provider}. ` +
        `Install it or switch STORAGE_PROVIDER back to local.`,
      );
    }
  }
}
