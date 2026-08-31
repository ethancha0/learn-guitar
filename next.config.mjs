import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project so Next doesn't walk up to the home
  // directory (a stray package-lock.json lives there).
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  outputFileTracingIncludes: {
    // Note: no yt-dlp here on purpose. The npm `youtube-dl-exec` binary is a
    // `#!/usr/bin/env python3` zipapp and managed serverless images ship no
    // Python, so production routes YouTube work to services/yt-dlp-worker via
    // YOUTUBE_WORKER_URL. See lib/youtube/provider.ts.
    "/api/youtube/*": [
      "./node_modules/ffmpeg-static/ffmpeg*",
      "./node_modules/@derhuerst/ffprobe-static/ffprobe*",
    ],
    "/api/align": [
      "./node_modules/ffmpeg-static/ffmpeg*",
      "./node_modules/@derhuerst/ffprobe-static/ffprobe*",
    ],
  },
};

export default nextConfig;
