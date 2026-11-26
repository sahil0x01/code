FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && mkdir /workspace \
    && chown node:node /workspace
