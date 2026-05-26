FROM node:22-alpine AS base
RUN npm install -g pnpm@10.6.1
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/frontend/package.json ./apps/frontend/
COPY libraries/nestjs-libraries/src/database/prisma/schema.prisma ./libraries/nestjs-libraries/src/database/prisma/
RUN pnpm install --frozen-lockfile --filter @socialpilot/frontend...

# ── Build ─────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
RUN pnpm --filter @socialpilot/frontend run build

# ── Production image ──────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

USER nextjs
EXPOSE 4200
ENV NODE_ENV=production PORT=4200 HOSTNAME=0.0.0.0

CMD ["node", "apps/frontend/server.js"]
