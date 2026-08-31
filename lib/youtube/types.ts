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

export interface DownloadedYouTubeAudio {
  videoId: string;
  title: string;
  uploader: string;
  durationSec: number;
  thumbnailUrl?: string;
  path: string;
  fileName: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  metadata: MediaMetadata;
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
  | "INSPECTION_FAILED";

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
