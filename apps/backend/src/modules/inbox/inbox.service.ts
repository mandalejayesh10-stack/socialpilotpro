import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { decrypt } from '../../common/utils/crypto.util';
import axios from 'axios';
import { google } from 'googleapis';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private prisma: PrismaService) {}

  // ── List conversations ────────────────────────────────────
  async getConversations(
    organizationId: string,
    filters: {
      platform?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { platform, status, search, page = 1, limit = 30 } = filters;

    const where: any = {
      organizationId,
      ...(platform && { platform: platform.toUpperCase() }),
      ...(status && { status: status.toUpperCase() }),
      ...(search && {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { lastMessage: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.inboxConversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inboxConversation.count({ where }),
    ]);

    return {
      conversations,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // ── Get single conversation with messages ─────────────────
  async getConversation(organizationId: string, conversationId: string) {
    const conversation = await this.prisma.inboxConversation.findFirst({
      where: { id: conversationId, organizationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          where: { isDeleted: false },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    // Mark as read
    await this.prisma.inboxConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });

    return conversation;
  }

  // ── Get messages for a conversation ──────────────────────
  async getMessages(organizationId: string, conversationId: string) {
    const conversation = await this.prisma.inboxConversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.inboxMessage.findMany({
      where: { conversationId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Reply to a comment ────────────────────────────────────
  async reply(
    organizationId: string,
    conversationId: string,
    message: string,
  ) {
    const conversation = await this.prisma.inboxConversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const integration = await this.prisma.integration.findFirst({
      where: { id: conversation.integrationId, deletedAt: null },
    });
    if (!integration) throw new NotFoundException('Integration not found');

    const token = decrypt(integration.accessToken);
    let platformMessageId: string | undefined;

    if (conversation.platform === 'YOUTUBE') {
      platformMessageId = await this.replyYouTube(
        conversation.platformConversationId,
        message,
        token,
        integration.refreshToken ? decrypt(integration.refreshToken) : null,
      );
    } else if (conversation.platform === 'FACEBOOK' || conversation.platform === 'INSTAGRAM') {
      platformMessageId = await this.replyMeta(
        conversation.platformConversationId,
        message,
        token,
      );
    }

    // Save reply to DB
    const saved = await this.prisma.inboxMessage.create({
      data: {
        conversationId,
        senderType: 'OWNER',
        senderName: integration.name,
        senderAvatar: integration.pictureUrl,
        message,
        platformMessageId,
      },
    });

    // Update conversation
    await this.prisma.inboxConversation.update({
      where: { id: conversationId },
      data: {
        lastMessage: message,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return saved;
  }

  // ── Resolve / unresolve conversation ──────────────────────
  async resolve(organizationId: string, conversationId: string, resolved: boolean) {
    const conversation = await this.prisma.inboxConversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.inboxConversation.update({
      where: { id: conversationId },
      data: { status: resolved ? 'RESOLVED' : 'OPEN' },
    });
  }

  // ── Mark as spam ──────────────────────────────────────────
  async markSpam(organizationId: string, conversationId: string, spam: boolean) {
    const conversation = await this.prisma.inboxConversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.inboxConversation.update({
      where: { id: conversationId },
      data: { isSpam: spam, status: spam ? 'SPAM' : 'OPEN' },
    });
  }

  // ── Get unread count ──────────────────────────────────────
  async getUnreadCount(organizationId: string) {
    const total = await this.prisma.inboxConversation.aggregate({
      where: { organizationId, status: 'OPEN' },
      _sum: { unreadCount: true },
    });

    const byPlatform = await this.prisma.inboxConversation.groupBy({
      by: ['platform'],
      where: { organizationId, unreadCount: { gt: 0 } },
      _sum: { unreadCount: true },
    });

    return {
      total: total._sum.unreadCount || 0,
      byPlatform: byPlatform.reduce((acc: any, p) => {
        acc[p.platform.toLowerCase()] = p._sum.unreadCount || 0;
        return acc;
      }, {}),
    };
  }

  // ── AI suggest reply ──────────────────────────────────────
  async suggestReply(organizationId: string, conversationId: string) {
    const conversation = await this.prisma.inboxConversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const lastMsg = conversation.messages[0]?.message || '';

    // Simple template suggestions — replace with Ollama when available
    const suggestions = [
      `Thank you for your comment! We appreciate your feedback. 😊`,
      `Thanks for reaching out! We'll look into this right away.`,
      `We appreciate your support! Stay tuned for more content. 🙌`,
    ];

    return { suggestions, context: lastMsg };
  }

  // ── Sync YouTube comments (cron every 5 min) ──────────────
  @Cron('*/5 * * * *')
  async syncYouTubeComments() {
    const integrations = await this.prisma.integration.findMany({
      where: { platform: 'YOUTUBE', deletedAt: null, disabled: false, refreshNeeded: false },
    });

    for (const integration of integrations) {
      try {
        await this.fetchYouTubeComments(integration);
      } catch (err) {
        // Don't mark as failed for permission errors — token may not have comment scope
        if (!err.message?.includes('Insufficient Permission')) {
          this.logger.error(`YouTube inbox sync failed for ${integration.id}: ${err.message}`);
        }
      }
    }
  }

  // ── Sync Meta comments (cron every 5 min) ────────────────
  @Cron('*/5 * * * *')
  async syncMetaComments() {
    const integrations = await this.prisma.integration.findMany({
      where: {
        platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
      },
    });

    for (const integration of integrations) {
      try {
        await this.fetchMetaComments(integration);
      } catch (err) {
        this.logger.error(`Meta inbox sync failed for ${integration.id}: ${err.message}`);
      }
    }
  }

  // ── YouTube: fetch comment threads ───────────────────────
  private async fetchYouTubeComments(integration: any) {
    const token = decrypt(integration.accessToken);
    const refreshToken = integration.refreshToken ? decrypt(integration.refreshToken) : null;

    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({ access_token: token, refresh_token: refreshToken || undefined });

    const youtube = google.youtube({ version: 'v3', auth });

    // Get recent videos
    const videosRes = await youtube.search.list({
      part: ['snippet'],
      forMine: true,
      type: ['video'],
      maxResults: 10,
      order: 'date',
    });

    const videos = videosRes.data.items || [];

    for (const video of videos) {
      const videoId = video.id?.videoId;
      if (!videoId) continue;

      try {
        const commentsRes = await youtube.commentThreads.list({
          part: ['snippet', 'replies'],
          videoId,
          maxResults: 50,
          order: 'time',
        });

        for (const thread of commentsRes.data.items || []) {
          const topComment = thread.snippet?.topLevelComment?.snippet;
          if (!topComment) continue;

          const conversationId = `${videoId}_${thread.id}`;

          // Upsert conversation
          const conversation = await this.prisma.inboxConversation.upsert({
            where: {
              organizationId_platform_platformConversationId: {
                organizationId: integration.organizationId,
                platform: 'YOUTUBE',
                platformConversationId: conversationId,
              },
            },
            create: {
              organizationId: integration.organizationId,
              integrationId: integration.id,
              platform: 'YOUTUBE',
              platformConversationId: conversationId,
              externalPostId: videoId,
              externalPostTitle: video.snippet?.title,
              externalPostUrl: `https://www.youtube.com/watch?v=${videoId}`,
              username: topComment.authorDisplayName || 'Unknown',
              userAvatar: topComment.authorProfileImageUrl,
              userId: topComment.authorChannelId?.value,
              lastMessage: topComment.textDisplay?.slice(0, 200),
              lastMessageAt: new Date(topComment.publishedAt || Date.now()),
              unreadCount: 1,
            },
            update: {
              lastMessage: topComment.textDisplay?.slice(0, 200),
              lastMessageAt: new Date(topComment.updatedAt || topComment.publishedAt || Date.now()),
              updatedAt: new Date(),
            },
          });

          // Upsert top-level comment as message
          await this.upsertInboxMessage(
            conversation.id,
            thread.snippet?.topLevelComment?.id || conversationId,
            {
              conversationId: conversation.id,
              senderType: 'USER',
              senderName: topComment.authorDisplayName || 'Unknown',
              senderAvatar: topComment.authorProfileImageUrl,
              senderId: topComment.authorChannelId?.value,
              message: topComment.textDisplay || '',
              platformMessageId: thread.snippet?.topLevelComment?.id,
              likeCount: topComment.likeCount || 0,
              createdAt: new Date(topComment.publishedAt || Date.now()),
            },
            {
              message: topComment.textDisplay || '',
              likeCount: topComment.likeCount || 0,
              isEdited: topComment.publishedAt !== topComment.updatedAt,
            },
          );

          // Upsert replies
          for (const reply of thread.replies?.comments || []) {
            const replySnippet = reply.snippet;
            if (!replySnippet) continue;

            const isOwner = replySnippet.authorChannelId?.value === integration.internalId;

            await this.upsertInboxMessage(
              conversation.id,
              reply.id || `reply_${reply.id}`,
              {
                conversationId: conversation.id,
                senderType: isOwner ? 'OWNER' : 'USER',
                senderName: replySnippet.authorDisplayName || 'Unknown',
                senderAvatar: replySnippet.authorProfileImageUrl,
                senderId: replySnippet.authorChannelId?.value,
                message: replySnippet.textDisplay || '',
                platformMessageId: reply.id,
                likeCount: replySnippet.likeCount || 0,
                createdAt: new Date(replySnippet.publishedAt || Date.now()),
              },
              {
                message: replySnippet.textDisplay || '',
                likeCount: replySnippet.likeCount || 0,
              },
            );
          }
        }
      } catch (err) {
        this.logger.warn(`YouTube comments for video ${videoId}: ${err.message}`);
      }
    }
  }

  // ── Meta: fetch comments ──────────────────────────────────
  private async fetchMetaComments(integration: any) {
    const META_VERSION = process.env.META_API_VERSION || 'v21.0';
    const BASE = `https://graph.facebook.com/${META_VERSION}`;
    const token = decrypt(integration.accessToken);

    let posts: any[] = [];

    try {
      if (integration.platform === 'FACEBOOK') {
        const pageId = integration.pageId || integration.internalId;
        const pageToken = integration.pageAccessToken
          ? decrypt(integration.pageAccessToken)
          : token;

        const res = await axios.get(`${BASE}/${pageId}/posts`, {
          params: { access_token: pageToken, fields: 'id,message,created_time', limit: 10 },
        });
        posts = res.data.data || [];

        for (const post of posts) {
          await this.fetchMetaPostComments(integration, post.id, post.message, pageToken, 'FACEBOOK');
        }
      } else if (integration.platform === 'INSTAGRAM') {
        const res = await axios.get(`${BASE}/${integration.internalId}/media`, {
          params: { access_token: token, fields: 'id,caption,timestamp', limit: 10 },
        });
        posts = res.data.data || [];

        for (const post of posts) {
          await this.fetchMetaPostComments(integration, post.id, post.caption, token, 'INSTAGRAM');
        }
      }
    } catch (err) {
      this.logger.warn(`Meta fetch failed for ${integration.id}: ${err.message}`);
    }
  }

  private async fetchMetaPostComments(
    integration: any,
    postId: string,
    postCaption: string,
    token: string,
    platform: 'FACEBOOK' | 'INSTAGRAM',
  ) {
    const META_VERSION = process.env.META_API_VERSION || 'v21.0';
    const BASE = `https://graph.facebook.com/${META_VERSION}`;

    try {
      const res = await axios.get(`${BASE}/${postId}/comments`, {
        params: {
          access_token: token,
          fields: 'id,message,from,created_time,like_count,replies{id,message,from,created_time}',
          limit: 50,
        },
      });

      for (const comment of res.data.data || []) {
        const conversation = await this.prisma.inboxConversation.upsert({
          where: {
            organizationId_platform_platformConversationId: {
              organizationId: integration.organizationId,
              platform: platform as any,
              platformConversationId: comment.id,
            },
          },
          create: {
            organizationId: integration.organizationId,
            integrationId: integration.id,
            platform: platform as any,
            platformConversationId: comment.id,
            externalPostId: postId,
            externalPostTitle: postCaption?.slice(0, 100),
            externalPostUrl: platform === 'FACEBOOK'
              ? `https://www.facebook.com/${postId}`
              : `https://www.instagram.com/p/${postId}`,
            username: comment.from?.name || 'Unknown',
            userId: comment.from?.id,
            lastMessage: comment.message?.slice(0, 200),
            lastMessageAt: new Date(comment.created_time),
            unreadCount: 1,
          },
          update: {
            lastMessage: comment.message?.slice(0, 200),
            lastMessageAt: new Date(comment.created_time),
            updatedAt: new Date(),
          },
        });

        // Upsert comment as message
        await this.upsertInboxMessage(
          conversation.id,
          comment.id,
          {
            conversationId: conversation.id,
            senderType: 'USER',
            senderName: comment.from?.name || 'Unknown',
            senderId: comment.from?.id,
            message: comment.message || '',
            platformMessageId: comment.id,
            likeCount: comment.like_count || 0,
            createdAt: new Date(comment.created_time),
          },
          {
            message: comment.message || '',
            likeCount: comment.like_count || 0,
          },
        );

        // Upsert replies
        for (const reply of comment.replies?.data || []) {
          const isOwner = reply.from?.id === integration.internalId ||
            reply.from?.id === integration.pageId;

          await this.upsertInboxMessage(
            conversation.id,
            reply.id,
            {
              conversationId: conversation.id,
              senderType: isOwner ? 'OWNER' : 'USER',
              senderName: reply.from?.name || 'Unknown',
              senderId: reply.from?.id,
              message: reply.message || '',
              platformMessageId: reply.id,
              createdAt: new Date(reply.created_time),
            },
            { message: reply.message || '' },
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Meta comments for post ${postId}: ${err.message}`);
    }
  }

  // ── YouTube: reply to comment ─────────────────────────────
  private async upsertInboxMessage(
    conversationId: string,
    platformMessageId: string,
    create: any,
    update: any,
  ) {
    const existing = await this.prisma.inboxMessage.findFirst({
      where: { conversationId, platformMessageId },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.inboxMessage.update({
        where: { id: existing.id },
        data: update,
      });
    }
    return this.prisma.inboxMessage.create({ data: create });
  }

  private async replyYouTube(
    platformConversationId: string,
    message: string,
    token: string,
    refreshToken: string | null,
  ): Promise<string> {
    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({ access_token: token, refresh_token: refreshToken || undefined });

    const youtube = google.youtube({ version: 'v3', auth });

    // platformConversationId = videoId_commentThreadId
    const parts = platformConversationId.split('_');
    const commentThreadId = parts[parts.length - 1];

    const res = await youtube.comments.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          parentId: commentThreadId,
          textOriginal: message,
        },
      },
    });

    return res.data.id || '';
  }

  // ── Meta: reply to comment ────────────────────────────────
  private async replyMeta(
    platformConversationId: string,
    message: string,
    token: string,
  ): Promise<string> {
    const META_VERSION = process.env.META_API_VERSION || 'v21.0';
    const BASE = `https://graph.facebook.com/${META_VERSION}`;

    const res = await axios.post(`${BASE}/${platformConversationId}/replies`, {
      message,
      access_token: token,
    });

    return res.data.id || '';
  }

  // ── Manual sync trigger ───────────────────────────────────
  async triggerSync(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId, deletedAt: null, disabled: false },
    });

    let synced = 0;
    for (const integration of integrations) {
      try {
        if (integration.platform === 'YOUTUBE') {
          await this.fetchYouTubeComments(integration);
        } else {
          await this.fetchMetaComments(integration);
        }
        synced++;
      } catch (err) {
        this.logger.warn(`Sync failed for ${integration.id}: ${err.message}`);
      }
    }

    return { synced, total: integrations.length };
  }
}
