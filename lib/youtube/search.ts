import {
  safeFileName,
  validateYouTubeVideoIdOrUrl,
  youtubeWatchUrl,
  runTool,
} from "./metadata";
import {
  type YouTubeSearchResult,
  YouTubeToolError,
  YOUTUBE_MAX_DURATION_SEC,
} from "./types";

interface YtDlpThumbnail {
  url?: string;
  preference?: number;
  width?: number;
}

interface YtDlpSearchEntry {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  upload_date?: string;
  thumbnail?: string;
  thumbnails?: YtDlpThumbnail[];
}

interface YtDlpSearchResponse {
  entries?: YtDlpSearchEntry[];
}

function bestThumbnail(entry: YtDlpSearchEntry): string | undefined {
  if (entry.thumbnail) return entry.thumbnail;
  return entry.thumbnails
    ?.filter((thumbnail) => thumbnail.url)
    .sort(
      (a, b) =>
        (b.preference ?? 0) - (a.preference ?? 0) ||
        (b.width ?? 0) - (a.width ?? 0),
    )[0]?.url;
}

function publishedAtFromUploadDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

function toResult(entry: YtDlpSearchEntry): YouTubeSearchResult | null {
  if (!entry.id || !entry.title) return null;
  let videoId: string;
  try {
    videoId = validateYouTubeVideoIdOrUrl(entry.id);
  } catch {
    return null;
  }

  const durationSec = Math.round(Number(entry.duration) || 0);
  if (durationSec > YOUTUBE_MAX_DURATION_SEC) return null;

  return {
    videoId,
    title: entry.title,
    channelTitle: entry.uploader ?? entry.channel ?? "YouTube",
    thumbnailUrl: bestThumbnail(entry),
    durationSec,
    publishedAt: publishedAtFromUploadDate(entry.upload_date),
    url: youtubeWatchUrl(videoId),
  };
}

export async function searchYouTube(
  query: string,
  options: { maxResults?: number; maxDurationSec?: number } = {},
): Promise<YouTubeSearchResult[]> {
  const q = query.trim();
  if (!q) {
    throw new YouTubeToolError("VALIDATION", "Search query is required.");
  }
  if (q.length > 200) {
    throw new YouTubeToolError(
      "VALIDATION",
      "Search query must be 200 characters or fewer.",
    );
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? 8, 1), 20);
  const maxDurationSec = options.maxDurationSec ?? YOUTUBE_MAX_DURATION_SEC;
  const result = await runTool(
    "yt-dlp",
    [
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      "--ignore-no-formats-error",
      `ytsearch${maxResults}:${q}`,
    ],
    { timeoutMs: 90_000 },
  );

  if (result.code !== 0) {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      "yt-dlp could not search YouTube.",
      result.stderr,
    );
  }

  let data: YtDlpSearchResponse;
  try {
    data = JSON.parse(result.stdout) as YtDlpSearchResponse;
  } catch {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      "yt-dlp returned invalid search JSON.",
      result.stdout,
    );
  }

  return (data.entries ?? [])
    .map(toResult)
    .filter((entry): entry is YouTubeSearchResult => Boolean(entry))
    .filter((entry) => entry.durationSec <= maxDurationSec)
    .slice(0, maxResults)
    .map((entry) => ({
      ...entry,
      title: entry.title || safeFileName(entry.videoId),
    }));
}
