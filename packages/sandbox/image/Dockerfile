FROM node:24-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
        ripgrep jq unzip zip make g++ python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && mkdir /workspace \
    && chown node:node /workspace
