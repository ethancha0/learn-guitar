/**
 * Client for the container-hosted yt-dlp worker (`services/yt-dlp-worker`).
 *
 * Serverless hosts cannot run yt-dlp: Vercel's Node lambda has no `python3` for
 * the `youtube-dl-exec` zipapp, and YouTube bot-blocks datacenter IPs anyway.
 * In production the app proxies both search and download to a worker that owns
 * yt-dlp, ffmpeg, and (optionally) cookies/proxy credentials.
 *
 * Configure with `YOUTUBE_WORKER_URL` + `YOUTUBE_WORKER_TOKEN`.
 */

import {
  type DownloadedYouTubeAudio,
  type YouTubeAudioMeta,
  type YouTubeSearchResult,
  type YouTubeToolErrorCode,
  YouTubeToolError,
} from "./types";

export interface WorkerConfig {
  baseUrl: string;
  token: string;
}

/** Worker error codes we pass through verbatim; anything else becomes a generic failure. */
const PASSTHROUGH_CODES = new Set<YouTubeToolErrorCode>([
  "VALIDATION",
  "DURATION_TOO_LONG",
  "DOWNLOAD_FAILED",
  "INSPECTION_FAILED",
  "MISSING_DEPENDENCY",
  "BOT_CHECK",
]);

export function workerConfig(): WorkerConfig | null {
  const baseUrl = process.env.YOUTUBE_WORKER_URL?.trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token: process.env.YOUTUBE_WORKER_TOKEN?.trim() ?? "",
  };
}

export function isWorkerEnabled(): boolean {
  return workerConfig() !== null;
}

function workerUrl(config: WorkerConfig, pathname: string): string {
  return `${config.baseUrl}${pathname}`;
}

function authHeaders(config: WorkerConfig): HeadersInit {
  return config.token ? { Authorization: `Bearer ${config.token}` } : {};
}

async function request(
  config: WorkerConfig,
  pathname: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 120_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(workerUrl(config, pathname), {
      ...rest,
      cache: "no-store",
      signal: controller.signal,
      headers: { ...authHeaders(config), ...rest.headers },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new YouTubeToolError(
      "WORKER_UNAVAILABLE",
      aborted
        ? `The YouTube worker did not respond within ${Math.round(timeoutMs / 1000)} seconds.`
        : "Could not reach the YouTube worker.",
      err instanceof Error ? err.message : undefined,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw await workerError(response);
  return response;
}

async function workerError(response: Response): Promise<YouTubeToolError> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
    details?: string;
  } | null;

  if (response.status === 401 || response.status === 403) {
    return new YouTubeToolError(
      "WORKER_UNAVAILABLE",
      "The YouTube worker rejected this app's token. Check YOUTUBE_WORKER_TOKEN.",
    );
  }

  const code = body?.code as YouTubeToolErrorCode | undefined;
  if (code && PASSTHROUGH_CODES.has(code)) {
    return new YouTubeToolError(
      code,
      body?.error ?? "The YouTube worker reported an error.",
      body?.details,
    );
  }

  return new YouTubeToolError(
    "WORKER_UNAVAILABLE",
    body?.error ?? `The YouTube worker failed with HTTP ${response.status}.`,
    body?.details,
  );
}

export async function workerSearch(
  config: WorkerConfig,
  query: string,
  options: { maxResults?: number; maxDurationSec?: number } = {},
): Promise<YouTubeSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (options.maxResults) params.set("maxResults", String(options.maxResults));
  if (options.maxDurationSec) {
    params.set("maxDurationSec", String(options.maxDurationSec));
  }

  const response = await request(config, `/search?${params}`, {
    method: "GET",
    timeoutMs: 60_000,
  });
  const body = (await response.json()) as { results?: YouTubeSearchResult[] };
  return body.results ?? [];
}

function parseAudioMeta(response: Response): YouTubeAudioMeta {
  const header = response.headers.get("X-Audio-Metadata");
  if (!header) {
    throw new YouTubeToolError(
      "WORKER_UNAVAILABLE",
      "The YouTube worker response was missing audio metadata.",
    );
  }
  try {
    return JSON.parse(
      Buffer.from(header, "base64").toString("utf8"),
    ) as YouTubeAudioMeta;
  } catch {
    throw new YouTubeToolError(
      "WORKER_UNAVAILABLE",
      "The YouTube worker returned unreadable audio metadata.",
    );
  }
}

export async function workerDownload(
  config: WorkerConfig,
  input: string,
  options: { maxDurationSec?: number } = {},
): Promise<DownloadedYouTubeAudio> {
  const response = await request(config, "/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId: input,
      maxDurationSec: options.maxDurationSec,
    }),
    timeoutMs: 280_000,
  });

  const meta = parseAudioMeta(response);
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    ...meta,
    // Trust the transferred length over the worker's pre-stream estimate.
    sizeBytes: bytes.byteLength,
    bytes,
    cleanup: async () => {},
  };
}
