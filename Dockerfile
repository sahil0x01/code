# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/web apps/web
COPY packages/db packages/db
ARG NEXT_PUBLIC_APP_URL
RUN test -n "$NEXT_PUBLIC_APP_URL" || (echo "NEXT_PUBLIC_APP_URL build arg is required" && exit 1)
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-real-secret-0000 \
    GITHUB_CLIENT_ID=build-placeholder \
    GITHUB_CLIENT_SECRET=build-placeholder \
    GITHUB_APP_ID=1 \
    GITHUB_APP_SLUG=build-placeholder \
    GITHUB_APP_WEBHOOK_SECRET=build-only-placeholder \
    GITHUB_APP_PRIVATE_KEY_BASE64=build-placeholder \
    ENV_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
RUN pnpm --filter @nullfuse/web build

FROM deps AS migrate
COPY packages/db packages/db
WORKDIR /repo/packages/db
CMD ["pnpm", "db:migrate"]

FROM node:24-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
