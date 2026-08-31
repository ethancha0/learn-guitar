import { fileURLToPath } from "node:url";

const youtubeBinaries = [
  "./node_modules/youtube-dl-exec/bin/**",
  "./node_modules/ffmpeg-static/ffmpeg",
  "./node_modules/ffmpeg-static/ffmpeg.exe",
  "./node_modules/@derhuerst/ffprobe-static/ffprobe",
  "./node_modules/@derhuerst/ffprobe-static/ffprobe.exe",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project so Next doesn't walk up to the home
  // directory (a stray package-lock.json lives there).
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  // Keep these packages unbundled so `require.resolve` / `__dirname` still
  // point at the real npm install (and its downloaded binaries) at runtime.
  serverExternalPackages: [
    "youtube-dl-exec",
    "ffmpeg-static",
    "@derhuerst/ffprobe-static",
  ],
  outputFileTracingIncludes: {
    "/api/youtube/search": youtubeBinaries,
    "/api/youtube/download": youtubeBinaries,
    "/api/youtube/*": youtubeBinaries,
    "/api/align": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffmpeg-static/ffmpeg.exe",
      "./node_modules/@derhuerst/ffprobe-static/ffprobe",
      "./node_modules/@derhuerst/ffprobe-static/ffprobe.exe",
    ],
  },
};

export default nextConfig;
