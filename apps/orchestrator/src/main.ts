import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { OrchestratorModule } from './orchestrator.module';

async function bootstrap() {
  const logger = new Logger('Orchestrator');
  const app = await NestFactory.create(OrchestratorModule, {
    logger: ['error', 'warn', 'log'],
  });

  const port = process.env.ORCHESTRATOR_PORT || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`Orchestrator running on port ${port}`);
  logger.log('Background jobs active: token refresh, analytics pipeline, post scheduler');
}

bootstrap();
