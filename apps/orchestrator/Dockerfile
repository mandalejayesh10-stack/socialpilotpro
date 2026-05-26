FROM node:22-alpine AS base
RUN npm install -g pnpm@10.6.1
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/orchestrator/package.json ./apps/orchestrator/
COPY libraries/nestjs-libraries/package.json ./libraries/nestjs-libraries/
COPY libraries/nestjs-libraries/src/database/prisma/schema.prisma ./libraries/nestjs-libraries/src/database/prisma/
RUN pnpm install --frozen-lockfile --filter @socialpilot/orchestrator...

FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/orchestrator ./apps/orchestrator
COPY libraries ./libraries
RUN pnpm --filter @socialpilot/orchestrator run build

FROM node:22-alpine AS runner
RUN npm install -g pnpm@10.6.1
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=builder /app/apps/orchestrator/dist ./dist
COPY --from=builder /app/apps/orchestrator/package.json ./
COPY --from=builder /app/node_modules ./node_modules

USER nestjs
EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
