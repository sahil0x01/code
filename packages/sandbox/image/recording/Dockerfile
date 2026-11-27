FROM node:24-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
        ripgrep jq unzip zip make g++ python3 python3-pip python3-venv \
    && corepack enable \
    && mkdir /workspace \
    && chown node:node /workspace \
    && mkdir /opt/nullfuse \
    && cd /opt/nullfuse \
    && npm install --no-audit --no-fund @playwright/test@1.65.0 \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
