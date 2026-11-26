FROM node:24-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && corepack enable \
    && mkdir /workspace \
    && chown node:node /workspace \
    && mkdir /opt/nullfuse \
    && cd /opt/nullfuse \
    && npm install --no-audit --no-fund @playwright/test@1.65.0 \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY record.mjs /opt/nullfuse/record.mjs
