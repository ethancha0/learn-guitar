/**
 * Chooses how YouTube search/download actually run.
 *
 * - `worker` — proxy to `services/yt-dlp-worker` over HTTP. Required in
 *   production; set `YOUTUBE_WORKER_URL` (and `YOUTUBE_WORKER_TOKEN`).
 * - `local`  — spawn yt-dlp/ffmpeg on this machine. Dev only.
 *
 * Set `YOUTUBE_PROVIDER=local|worker` to force one explicitly.
 */

import { type WorkerConfig, workerConfig } from "./workerClient";
import { YouTubeToolError } from "./types";

export type YouTubeProvider =
  | { kind: "worker"; config: WorkerConfig }
  | { kind: "local" };

/**
 * Managed serverless runtimes cannot exec yt-dlp: the `youtube-dl-exec` binary
 * is a `#!/usr/bin/env python3` zipapp and these images ship no Python.
 */
function isManagedServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY,
  );
}

export function resolveYouTubeProvider(): YouTubeProvider {
  const forced = process.env.YOUTUBE_PROVIDER?.trim().toLowerCase();
  const config = workerConfig();

  if (forced === "local") return { kind: "local" };
  if (config && forced !== "local") return { kind: "worker", config };

  if (forced === "worker" || isManagedServerless()) {
    throw new YouTubeToolError(
      "MISSING_DEPENDENCY",
      "YouTube import is not configured on this deployment. Set YOUTUBE_WORKER_URL (and YOUTUBE_WORKER_TOKEN) to a running yt-dlp worker.",
      "See services/yt-dlp-worker/README.md.",
    );
  }

  return { kind: "local" };
}
