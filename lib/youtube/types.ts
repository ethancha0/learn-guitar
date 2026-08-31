export const YOUTUBE_MAX_DURATION_SEC = 15 * 60;

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl?: string;
  durationSec: number;
  publishedAt?: string;
  url: string;
}

export interface MediaMetadata {
  durationSec: number;
  container?: string;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  bitRate?: number;
  sizeBytes?: number;
}

/**
 * Everything about a downloaded track except the audio itself. The worker
 * returns this as base64 JSON in `X-Audio-Metadata`; the local yt-dlp path
 * builds the same shape from ffprobe.
 */
export interface YouTubeAudioMeta {
  videoId: string;
  title: string;
  uploader: string;
  durationSec: number;
  thumbnailUrl?: string;
  fileName: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  metadata: MediaMetadata;
}

export interface DownloadedYouTubeAudio extends YouTubeAudioMeta {
  /** Set when the audio landed on local disk (the dev yt-dlp path). */
  path?: string;
  /** Set when the audio arrived over HTTP from the worker. */
  bytes?: Buffer;
  cleanup: () => Promise<void>;
}

export interface PreparedAlignmentAudio {
  wavPath: string;
  source: MediaMetadata;
  wav: MediaMetadata;
  cleanup: () => Promise<void>;
}

export type YouTubeToolErrorCode =
  | "MISSING_DEPENDENCY"
  | "VALIDATION"
  | "DURATION_TOO_LONG"
  | "DOWNLOAD_FAILED"
  | "INSPECTION_FAILED"
  /** YouTube refused the worker's IP ("Sign in to confirm you're not a bot"). */
  | "BOT_CHECK"
  /** The worker is unreachable, misconfigured, or returned a non-YouTube error. */
  | "WORKER_UNAVAILABLE";

export class YouTubeToolError extends Error {
  constructor(
    readonly code: YouTubeToolErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = "YouTubeToolError";
  }
}

const HTTP_STATUS_BY_CODE: Record<YouTubeToolErrorCode, number> = {
  VALIDATION: 400,
  DURATION_TOO_LONG: 422,
  MISSING_DEPENDENCY: 503,
  WORKER_UNAVAILABLE: 503,
  BOT_CHECK: 502,
  DOWNLOAD_FAILED: 502,
  INSPECTION_FAILED: 502,
};

export function httpStatusForYouTubeError(err: YouTubeToolError): number {
  return HTTP_STATUS_BY_CODE[err.code] ?? 502;
}
