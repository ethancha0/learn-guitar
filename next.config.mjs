import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project so Next doesn't walk up to the home
  // directory (a stray package-lock.json lives there).
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  outputFileTracingIncludes: {
    "/api/youtube/*": [
      "./node_modules/youtube-dl-exec/bin/**/*",
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
