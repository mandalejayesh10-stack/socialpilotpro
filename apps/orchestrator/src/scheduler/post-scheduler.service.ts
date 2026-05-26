import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { PRISMA } from '../database/database.module';
import axios from 'axios';
import { google } from 'googleapis';
import * as crypto from 'crypto';
import * as fs from 'fs';

function decrypt(ct: string): string {
  const key = Buffer.from((process.env.TOKEN_ENCRYPTION_KEY || '').padEnd(64, '0').slice(0, 64), 'hex');
  const buf = Buffer.from(ct, 'base64');
  const iv = buf.subarray(0, 16), tag = buf.subarray(16, 32), enc = buf.subarray(32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return d.update(enc) + d.final('utf8');
}

const V = process.env.META_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${V}`;

@Injectable()
export class PostSchedulerService {
  private readonly logger = new Logger('PostScheduler');

  constructor(@Inject(PRISMA) private prisma: PrismaClient) {}

  @Cron('* * * * *')
  async processQueue() {
    if (process.env.ENABLE_ORCHESTRATOR_PUBLISHER !== 'true') return;
    const due = await this.prisma.post.findMany({
      where: { state: 'QUEUE', publishDate: { lte: new Date() }, deletedAt: null },
      include: { integration: true },
      orderBy: { publishDate: 'asc' },
      take: 20,
    });

    if (!due.length) return;
    this.logger.log(`Publishing ${due.length} posts`);

    for (const post of due) {
      try {
        await this.publish(post);
      } catch (e: any) {
        this.logger.error(`Publish [${post.id}]: ${e.message}`);
        await this.prisma.post.update({ where: { id: post.id }, data: { state: 'ERROR', error: e.message } });
      }
    }
  }

  private async publish(post: any) {
    const token = decrypt(post.integration.accessToken);
    const mediaUrls: string[] = JSON.parse(post.mediaUrls || '[]');
    const caption = `${post.content}${post.hashtags ? '\n\n' + post.hashtags : ''}`;

    if (post.integration.platform === 'INSTAGRAM') {
      await this.assertPermanentPublicMediaUrls(mediaUrls, 'INSTAGRAM');
      await this.publishInstagram(post, token, mediaUrls, caption);
    } else if (post.integration.platform === 'FACEBOOK') {
      await this.assertPermanentPublicMediaUrls(mediaUrls, 'FACEBOOK');
      await this.publishFacebook(post, token, mediaUrls, caption);
    } else if (post.integration.platform === 'YOUTUBE') {
      const refresh = post.integration.refreshToken ? decrypt(post.integration.refreshToken) : null;
      await this.publishYoutube(post, token, refresh, mediaUrls, caption);
    }
  }

  private async assertPermanentPublicMediaUrls(mediaUrls: string[], platform: string) {
    for (const url of mediaUrls) {
      if (!url.startsWith('https://') || url.includes('localhost') || url.includes('127.0.0.1') || url.includes('ngrok-free') || url.includes('/uploads/')) {
        throw new Error(`${platform} publishing requires permanent public HTTPS CDN media URLs from Supabase, S3, or Cloudflare R2. Invalid URL: ${url}`);
      }
      const res = await axios.head(url, { timeout: 15000, validateStatus: () => true });
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (res.status < 200 || res.status >= 400 || (!contentType.startsWith('image/') && !contentType.startsWith('video/') && contentType !== 'application/octet-stream')) {
        throw new Error(`${platform} media URL failed accessibility check: ${url} status=${res.status} content-type=${contentType || 'missing'}`);
      }
    }
  }

  private async publishInstagram(post: any, token: string, mediaUrls: string[], caption: string) {
    const igId = post.integration.internalId;
    let mediaId: string;

    if (!mediaUrls.length) throw new Error('Instagram requires media');

    if (mediaUrls.length === 1) {
      const isVideo = /\.(mp4|mov|avi)$/i.test(mediaUrls[0]);
      const res = await axios.post(`${BASE}/${igId}/media`, {
        ...(isVideo ? { video_url: mediaUrls[0], media_type: 'REELS' } : { image_url: mediaUrls[0] }),
        caption, access_token: token,
      });
      mediaId = res.data.id;
    } else {
      const childIds: string[] = [];
      for (const url of mediaUrls) {
        const r = await axios.post(`${BASE}/${igId}/media`, { image_url: url, is_carousel_item: true, access_token: token });
        childIds.push(r.data.id);
      }
      const r = await axios.post(`${BASE}/${igId}/media`, { media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: token });
      mediaId = r.data.id;
    }

    // Wait for media to be ready
    await new Promise(r => setTimeout(r, 3000));

    const pub = await axios.post(`${BASE}/${igId}/media_publish`, { creation_id: mediaId, access_token: token });
    await this.markPublished(post.id, pub.data.id, `https://www.instagram.com/p/${pub.data.id}`);
  }

  private async publishFacebook(post: any, token: string, mediaUrls: string[], caption: string) {
    const pageId = post.integration.pageId || post.integration.internalId;
    const pageToken = post.integration.pageAccessToken ? decrypt(post.integration.pageAccessToken) : token;
    let res: any;

    if (!mediaUrls.length) {
      res = await axios.post(`${BASE}/${pageId}/feed`, { message: caption, access_token: pageToken });
    } else if (mediaUrls.length === 1) {
      const isVideo = /\.(mp4|mov|avi)$/i.test(mediaUrls[0]);
      res = isVideo
        ? await axios.post(`${BASE}/${pageId}/videos`, { file_url: mediaUrls[0], description: caption, access_token: pageToken })
        : await axios.post(`${BASE}/${pageId}/photos`, { url: mediaUrls[0], caption, access_token: pageToken });
    } else {
      const photoIds: string[] = [];
      for (const url of mediaUrls) {
        const r = await axios.post(`${BASE}/${pageId}/photos`, { url, published: false, access_token: pageToken });
        photoIds.push(r.data.id);
      }
      res = await axios.post(`${BASE}/${pageId}/feed`, {
        message: caption,
        attached_media: photoIds.map(id => ({ media_fbid: id })),
        access_token: pageToken,
      });
    }

    await this.markPublished(post.id, res.data.id, `https://www.facebook.com/${res.data.id}`);
  }

  private async publishYoutube(post: any, token: string, refresh: string | null, mediaUrls: string[], caption: string) {
    if (!mediaUrls.length) throw new Error('YouTube requires a video file');

    const auth = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET);
    auth.setCredentials({ access_token: token, refresh_token: refresh || undefined });
    const yt = google.youtube({ version: 'v3', auth });

    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: post.title || post.content.slice(0, 100),
          description: caption,
          tags: post.hashtags?.match(/#\w+/g)?.map((t: string) => t.slice(1)) || [],
        },
        status: { privacyStatus: 'public' },
      },
      media: { body: fs.createReadStream(mediaUrls[0]) },
    });

    await this.markPublished(post.id, res.data.id!, `https://www.youtube.com/watch?v=${res.data.id}`);
  }

  private async markPublished(postId: string, externalId: string, url: string) {
    await this.prisma.post.update({
      where: { id: postId },
      data: { state: 'PUBLISHED', externalId, publishedUrl: url },
    });

    // Increment usage counter
    const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { organizationId: true } });
    if (post) {
      await this.prisma.usageLimits.updateMany({
        where: { organizationId: post.organizationId },
        data: { postsUsed: { increment: 1 } },
      });
    }
  }
}
