# yt-dlp standalone Linux build (no Python runtime needed) + ffmpeg/ffprobe.
FROM node:22-bookworm-slim

# Pin a release for reproducible builds:
#   docker build --build-arg YT_DLP_VERSION=2025.09.26 .
ARG YT_DLP_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  if [ "$YT_DLP_VERSION" = "latest" ]; then \
    url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"; \
  else \
    url="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux"; \
  fi; \
  curl -fsSL "$url" -o /usr/local/bin/yt-dlp; \
  chmod 755 /usr/local/bin/yt-dlp; \
  /usr/local/bin/yt-dlp --version

WORKDIR /app
COPY package.json ./
COPY server.mjs ytdlp.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server.mjs"]
