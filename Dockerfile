# Shared image for web, worker and migrations (local Docker Compose deployment, PRD §29).
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS web
ENV NODE_ENV=production
RUN pnpm --filter @agentos/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@agentos/web", "start"]

FROM base AS worker
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@agentos/worker", "start"]
