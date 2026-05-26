import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

const compression = require('compression');
const cookieParser = require('cookie-parser');

// ── Startup env validation ────────────────────────────────────
function validateEnv(logger: Logger) {
  const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'TOKEN_ENCRYPTION_KEY'];
  const isProd = process.env.NODE_ENV === 'production';
  const OPTIONAL_OAUTH = [
    { key: 'GOOGLE_CLIENT_ID',     feature: 'Google OAuth login' },
    { key: 'GOOGLE_CLIENT_SECRET', feature: 'Google OAuth login' },
    { key: 'FACEBOOK_APP_ID',      feature: 'Meta (Instagram/Facebook) integration' },
    { key: 'FACEBOOK_APP_SECRET',  feature: 'Meta (Instagram/Facebook) integration' },
    { key: 'YOUTUBE_CLIENT_ID',    feature: 'YouTube integration' },
    { key: 'YOUTUBE_CLIENT_SECRET',feature: 'YouTube integration' },
    { key: 'STRIPE_SECRET_KEY',    feature: 'Stripe billing' },
  ];

  // Check required vars
  const missing = REQUIRED.filter(k => !process.env[k] || process.env[k]!.trim() === '');
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Add them to .env and restart the backend.');
    process.exit(1);
  }

  if (isProd) {
    const productionRequired = ['FRONTEND_URL', 'BACKEND_INTERNAL_URL'];
    const missingProduction = productionRequired.filter(k => !process.env[k] || process.env[k]!.trim() === '');
    if (missingProduction.length > 0) {
      logger.error(`Missing production environment variables: ${missingProduction.join(', ')}`);
      process.exit(1);
    }
    const localUrls = productionRequired.filter(k => /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(process.env[k] || ''));
    if (localUrls.length > 0) {
      logger.error(`Production URLs cannot point to localhost: ${localUrls.join(', ')}`);
      process.exit(1);
    }
    if (!process.env.CORS_ALLOWED_ORIGINS && process.env.FRONTEND_URL?.endsWith('.vercel.app')) {
      logger.warn('CORS_ALLOWED_ORIGINS is not set; using FRONTEND_URL only.');
    }
  }

  // Warn about optional vars
  const missingOptional = OPTIONAL_OAUTH.filter(
    o => !process.env[o.key] || process.env[o.key]!.trim() === '',
  );

  if (missingOptional.length > 0) {
    logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.warn('Optional env vars not set (features will be disabled):');
    const features = [...new Set(missingOptional.map(o => o.feature))];
    features.forEach(f => {
      const keys = missingOptional.filter(o => o.feature === f).map(o => o.key);
      logger.warn(`  ❌ ${f}: ${keys.join(', ')}`);
    });
    logger.warn('Add them to .env and restart to enable these features.');
    logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // ── Validate environment variables ───────────────────────────
  validateEnv(logger);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    rawBody: true,
  });

  // ── Middleware ──────────────────────────────────────────────
  app.use(compression());
  app.use(cookieParser());

  // ── Static file serving ───────────────────────────────────
  const uploadDir  = path.resolve(process.env.UPLOAD_DIRECTORY || './uploads');
  const reportsDir = path.resolve('./reports/pdf');
  const invoicesDir = path.resolve('./reports/invoices');

  // Create dirs if they don't exist
  const fs = require('fs');
  [uploadDir, reportsDir, invoicesDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  app.useStaticAssets(uploadDir,   { prefix: '/uploads' });

  // ── CORS ────────────────────────────────────────────────────
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.FRONTEND_URL ||
    (isProd ? '' : 'http://localhost:4200,http://localhost:3000')
  ).split(',').map((origin) => origin.trim()).filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProd && (origin.endsWith('.ngrok-free.app') || origin.endsWith('.ngrok.io') || origin.endsWith('.ngrok-free.dev'))) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id', 'ngrok-skip-browser-warning'],
  });

  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  // ── Global pipes / filters / interceptors ────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── Short legal URLs (no /api prefix) ────────────────────────
  // These are required by Meta Developer Console for Privacy Policy & Terms
  // Accessible at: https://tunnel.ngrok-free.dev/privacy
  //                https://tunnel.ngrok-free.dev/terms
  const expressApp = app.getHttpAdapter().getInstance();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
  const tunnelUrl   = process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';

  const legalStyle = `body{font-family:system-ui,sans-serif;background:#0f0f1a;color:#e0e0f0;margin:0;padding:0}
    header{background:#16162a;border-bottom:1px solid #2a2a45;padding:16px 32px;display:flex;align-items:center;gap:12px}
    .logo{width:32px;height:32px;background:#6366f1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px}
    main{max-width:760px;margin:0 auto;padding:48px 32px}
    h1{font-size:28px;font-weight:700;color:#fff;margin-bottom:4px}
    .date{color:#666;font-size:14px;margin-bottom:40px}
    h2{font-size:16px;font-weight:600;color:#c0c0e0;margin:32px 0 8px}
    p,li{font-size:14px;line-height:1.8;color:#a0a0c0}ul{padding-left:20px}
    a{color:#818cf8}.back{display:inline-block;margin-top:32px;background:#6366f1;color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-size:14px}`;

  expressApp.get('/privacy', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — SocialPilot Pro</title><style>${legalStyle}</style></head><body>
<header><div class="logo">S</div><strong style="color:#fff;font-size:16px">SocialPilot Pro</strong></header>
<main>
<h1>Privacy Policy</h1><p class="date">Last updated: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
<h2>1. Information We Collect</h2>
<p>We collect information you provide when creating an account, connecting social media accounts, or contacting support:</p>
<ul><li><strong>Account info:</strong> Name, email, password (bcrypt hashed)</li>
<li><strong>Social media data:</strong> OAuth tokens, profile info, post metrics — via official APIs with your explicit consent</li>
<li><strong>Payment info:</strong> Processed by Stripe — we never store card details</li></ul>
<h2>2. How We Use Your Information</h2>
<ul><li>Provide and improve our services</li><li>Schedule and publish posts on your behalf (only when you authorize)</li>
<li>Display analytics in your dashboard</li><li>Process payments and send receipts</li></ul>
<h2>3. Social Media Data</h2>
<p>We access your accounts only via official OAuth 2.0 (Meta Graph API, YouTube Data API). All tokens are encrypted at rest using AES-256-GCM. We do not sell your data.</p>
<h2>4. Data Deletion</h2>
<p>You may request deletion of your account and all data at any time by emailing: <a href="mailto:bamandlajayesh@gmail.com">bamandlajayesh@gmail.com</a>. We process requests within 30 days.</p>
<h2>5. Security</h2>
<p>AES-256-GCM encryption for tokens, bcrypt for passwords, HTTPS for all data in transit, JWT authentication with HTTP-only cookies.</p>
<h2>6. Your Rights (GDPR/CCPA)</h2>
<ul><li>Access, correct, or delete your personal data</li><li>Data portability</li><li>Withdraw consent at any time</li></ul>
<h2>7. Contact</h2>
<p>Email: <a href="mailto:bamandlajayesh@gmail.com">bamandlajayesh@gmail.com</a></p>
<a href="${frontendUrl}" class="back">← Back to SocialPilot Pro</a>
</main></body></html>`);
  });

  expressApp.get('/terms', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service — SocialPilot Pro</title><style>${legalStyle}</style></head><body>
<header><div class="logo">S</div><strong style="color:#fff;font-size:16px">SocialPilot Pro</strong></header>
<main>
<h1>Terms of Service</h1><p class="date">Last updated: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
<h2>1. Acceptance of Terms</h2>
<p>By using SocialPilot Pro, you agree to these Terms. If you do not agree, please do not use our service.</p>
<h2>2. Description of Service</h2>
<p>SocialPilot Pro is a social media management platform for scheduling posts, analyzing performance, and managing accounts via official APIs (Meta Graph API, YouTube Data API v3).</p>
<h2>3. Account Responsibilities</h2>
<ul><li>Maintain security of your credentials</li><li>Do not share your account</li><li>Notify us of any unauthorized use</li></ul>
<h2>4. Acceptable Use</h2>
<p>You agree not to violate applicable laws, platform terms of service, or post spam or misleading content.</p>
<h2>5. Platform Compliance</h2>
<p>You agree to comply with Meta's Platform Terms and YouTube's Terms of Service for all connected accounts.</p>
<h2>6. Billing</h2>
<ul><li>Subscriptions billed monthly or annually in advance</li><li>Cancel anytime; takes effect at end of billing period</li></ul>
<h2>7. Contact</h2>
<p>Email: <a href="mailto:bamandlajayesh@gmail.com">bamandlajayesh@gmail.com</a></p>
<a href="${frontendUrl}" class="back">← Back to SocialPilot Pro</a>
</main></body></html>`);
  });

  logger.log(`✅ Legal pages: ${tunnelUrl}/privacy  |  ${tunnelUrl}/terms`);

  // ── API prefix ───────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger (dev only) ───────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SocialPilot Pro API')
      .setDescription('Production-grade Social Media SaaS Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger docs: http://localhost:3000/api/docs');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`✅ Backend running → http://localhost:${port}`);
  logger.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
