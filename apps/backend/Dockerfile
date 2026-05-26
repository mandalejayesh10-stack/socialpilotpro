FROM node:22-alpine AS base
RUN npm install -g pnpm@10.6.1
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY libraries/nestjs-libraries/package.json ./libraries/nestjs-libraries/
COPY libraries/nestjs-libraries/src/database/prisma/schema.prisma ./libraries/nestjs-libraries/src/database/prisma/
RUN pnpm install --frozen-lockfile --filter @socialpilot/backend...

# ── Build ─────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/backend ./apps/backend
COPY libraries ./libraries
RUN pnpm --filter @socialpilot/backend run build

# ── Production image ──────────────────────────────────────────
FROM node:22-alpine AS runner
RUN npm install -g pnpm@10.6.1
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libraries ./libraries

RUN mkdir -p uploads reports/pdf tmp/media && \
    chown -R nestjs:nodejs uploads reports tmp

USER nestjs

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
