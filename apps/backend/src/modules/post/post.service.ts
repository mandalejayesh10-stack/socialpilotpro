import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { State } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface CreatePostDto {
  integrationIds: string[];
  content: string;
  mediaUrls?: string[];
  publishDate: Date;
  hashtags?: string;
  title?: string;
  settings?: Record<string, any>;
}

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);

  constructor(private prisma: PrismaService) {}

  // ── Create post (single or multi-platform) ────────────────
  async createPost(organizationId: string, dto: CreatePostDto) {
    const group = uuidv4(); // groups multi-platform posts together
    await this.validateScheduleMediaUrls(organizationId, dto.integrationIds, dto.mediaUrls || []);

    const posts = await Promise.all(
      dto.integrationIds.map((integrationId) =>
        this.prisma.post.create({
          data: {
            organizationId,
            integrationId,
            content: dto.content,
            mediaUrls: JSON.stringify(dto.mediaUrls || []),
            publishDate: new Date(dto.publishDate),
            hashtags: dto.hashtags,
            title: dto.title,
            settings: dto.settings ? JSON.stringify(dto.settings) : null,
            state: 'QUEUE',
            group,
          },
        }),
      ),
    );

    return posts;
  }

  private async validateScheduleMediaUrls(organizationId: string, integrationIds: string[], mediaUrls: string[]) {
    if (mediaUrls.length === 0) return;

    const integrations = await this.prisma.integration.findMany({
      where: { id: { in: integrationIds }, organizationId, deletedAt: null },
      select: { platform: true },
    });
    const requiresPublicUrl = integrations.some((i) => i.platform === 'INSTAGRAM' || i.platform === 'FACEBOOK');
    if (!requiresPublicUrl) return;

    const invalid = mediaUrls.find((url) => {
      const resolved = this.resolvePublicMediaUrl(url);
      if (!resolved?.startsWith('https://')) return true;
      return this.isPrivateOrLocalUrl(resolved);
    });

    if (invalid) {
      throw new BadRequestException(
        'Media needs a public HTTPS upload URL before it can publish to Instagram or Facebook.',
      );
    }
  }

  private resolvePublicMediaUrl(url: string) {
    if (!url) return '';
    if (url.startsWith('https://') || url.startsWith('http://')) return url;
    if (!url.startsWith('/uploads/')) return url;

    const base = (
      process.env.LOCAL_UPLOAD_PUBLIC_BASE_URL ||
      process.env.PUBLIC_UPLOAD_BASE_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      ''
    ).replace(/\/+$/, '');
    return base ? `${base}${url}` : url;
  }

  private isPrivateOrLocalUrl(url: string) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1' || hostname.endsWith('.local')) return true;
      if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
      const parts = hostname.split('.').map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isInteger(n))) {
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  // ── Get posts for calendar ────────────────────────────────
  async getPosts(
    organizationId: string,
    filters: {
      from?: Date;
      to?: Date;
      platform?: string;
      state?: State;
    } = {},
  ) {
    return this.prisma.post.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(filters.from && { publishDate: { gte: filters.from } }),
        ...(filters.to && { publishDate: { lte: filters.to } }),
        ...(filters.state && { state: filters.state }),
        ...(filters.platform && {
          integration: { platform: filters.platform.toUpperCase() as any },
        }),
      },
      include: {
        integration: {
          select: { id: true, platform: true, name: true, pictureUrl: true },
        },
        metrics: {
          orderBy: { periodDate: 'desc' },
          take: 1,
        },
      },
      orderBy: { publishDate: 'asc' },
    });
  }

  // ── Get single post ───────────────────────────────────────
  async getPost(organizationId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
      include: {
        integration: true,
        metrics: { orderBy: { periodDate: 'desc' }, take: 7 },
        tags: { include: { tag: true } },
        comments: {
          where: { deletedAt: null },
          include: { user: { select: { id: true, name: true, pictureUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  // ── Update post ───────────────────────────────────────────
  async updatePost(
    organizationId: string,
    postId: string,
    data: Partial<CreatePostDto>,
  ) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.state === 'PUBLISHED') {
      throw new ForbiddenException('Cannot edit a published post');
    }

    return this.prisma.post.update({
      where: { id: postId },
      data: {
        ...(data.content && { content: data.content }),
        ...(data.mediaUrls && { mediaUrls: JSON.stringify(data.mediaUrls) }),
        ...(data.publishDate && { publishDate: new Date(data.publishDate) }),
        ...(data.hashtags !== undefined && { hashtags: data.hashtags }),
        ...(data.settings && { settings: JSON.stringify(data.settings) }),
      },
    });
  }

  // ── Delete post ───────────────────────────────────────────
  async deletePost(organizationId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');

    await this.prisma.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });

    return { message: 'Post deleted' };
  }

  // ── Bulk schedule ─────────────────────────────────────────
  async bulkSchedule(
    organizationId: string,
    posts: Array<CreatePostDto>,
  ) {
    const results = await Promise.all(
      posts.map((post) => this.createPost(organizationId, post)),
    );
    return results.flat();
  }

  // ── Get posts due for publishing (atomic claim) ──────────
  async getDuePosts(workerId = `worker-${process.pid}`, limit = 25) {
    // Use a transaction to atomically claim posts — prevents double-publish
    // when multiple scheduler instances run (e.g. nodemon restart overlap)
    const now = new Date();

    const claimToken = uuidv4();
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      WITH due AS (
        SELECT id
        FROM "Post"
        WHERE state = 'QUEUE'::"State"
          AND "publishDate" <= $1
          AND "deletedAt" IS NULL
        ORDER BY "publishDate" ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "Post" p
      SET state = 'PROCESSING'::"State",
          "claimToken" = $3,
          "lockedAt" = $1,
          "lockedBy" = $4,
          error = NULL,
          "updatedAt" = $1
      FROM due
      WHERE p.id = due.id
      RETURNING p.id
    `, now, limit, claimToken, workerId);

    const ids = rows.map((p) => p.id);
    if (ids.length === 0) return [];

    // Now fetch the full records (only ones we successfully claimed)
    return this.prisma.post.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
      },
      include: { integration: true },
      orderBy: { publishDate: 'asc' },
    }) as any;
  }

  // ── Mark post as published ────────────────────────────────
  async markPublished(postId: string, externalId: string, publishedUrl?: string) {
    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { state: 'PUBLISHED', externalId, publishedUrl, error: null },
    });
    await this.clearLock(postId);
    return post;
  }

  // ── Mark post as failed ───────────────────────────────────
  async markFailed(postId: string, error: string) {
    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { state: 'ERROR', error },
    });
    await this.clearLock(postId);
    return post;
  }

  async releaseStuckProcessing(olderThanMinutes = 30) {
    const staleBefore = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const count = await this.prisma.$executeRawUnsafe(`
      UPDATE "Post"
      SET state = 'QUEUE'::"State",
          "claimToken" = NULL,
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          error = 'Recovered from stale processing lock',
          "updatedAt" = NOW()
      WHERE state = 'PROCESSING'::"State"
        AND "lockedAt" < $1
        AND "deletedAt" IS NULL
    `, staleBefore);
    return { count: Number(count) };
  }

  private async clearLock(postId: string) {
    await this.prisma.$executeRawUnsafe(`
      UPDATE "Post"
      SET "claimToken" = NULL,
          "lockedAt" = NULL,
          "lockedBy" = NULL
      WHERE id = $1
    `, postId);
  }

  // ── Get publish logs for a post ───────────────────────────
  async getPublishLogs(organizationId: string, postId: string) {
    // Verify post belongs to org
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');

    return this.prisma.publishLog.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
