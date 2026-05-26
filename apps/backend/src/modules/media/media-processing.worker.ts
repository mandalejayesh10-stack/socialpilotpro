import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MediaProcessingService, MEDIA_STATUSES } from './media-processing.service';

@Injectable()
export class MediaProcessingWorker implements OnModuleInit {
  private readonly logger = new Logger(MediaProcessingWorker.name);
  private running = false;
  private readonly concurrency = Math.max(1, Number(process.env.MEDIA_PROCESSING_CONCURRENCY || 1));

  constructor(
    private prisma: PrismaService,
    private processor: MediaProcessingService,
  ) {}

  onModuleInit() {
    const timer = setInterval(() => this.drain().catch((err) => this.logger.warn(`Drain failed: ${err.message}`)), 30_000);
    timer.unref?.();
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.prisma.uploadJob.findMany({
        where: { status: { in: [MEDIA_STATUSES.PROCESSING, MEDIA_STATUSES.UPLOADING_TO_CLOUD] } },
        orderBy: { createdAt: 'asc' },
        take: this.concurrency,
      });
      for (const job of jobs) {
        if (!job.mediaId) continue;
        const claimed = await this.prisma.uploadJob.updateMany({
          where: { id: job.id, status: job.status },
          data: { status: 'RUNNING', attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) continue;
        await this.processor.process(job.mediaId);
      }
    } finally {
      this.running = false;
    }
  }
}
