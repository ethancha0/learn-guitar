/**
 * YouTube InnerTube (the same JSON API the website uses). Search and audio
 * fetch work in serverless without spawning yt-dlp or ffmpeg.
 */

import {
  type YouTubeSearchResult,
  YouTubeToolError,
  YOUTUBE_MAX_DURATION_SEC,
} from "./types";

const YT_ORIGIN = "https://www.youtube.com";

const WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20260821.01.00",
  hl: "en",
  gl: "US",
} as const;

const ANDROID_CLIENT = {
  clientName: "ANDROID",
  clientVersion: "21.26.364",
  androidSdkVersion: 30,
  hl: "en",
  gl: "US",
  osName: "Android",
  osVersion: "11",
  userAgent:
    "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
} as const;

interface TextRuns {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

interface VideoRenderer {
  videoId?: string;
  title?: TextRuns;
  lengthText?: TextRuns;
  publishedTimeText?: TextRuns;
  ownerText?: TextRuns;
  shortBylineText?: TextRuns;
  thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> };
}

interface StreamingFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  audioQuality?: string;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    thumbnail?: { thumbnails?: Array<{ url?: string }> };
  };
  streamingData?: {
    formats?: StreamingFormat[];
    adaptiveFormats?: StreamingFormat[];
  };
}

export function textFrom(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const obj = value as TextRuns;
  if (obj.simpleText) return obj.simpleText;
  if (obj.runs?.length) return obj.runs.map((run) => run.text ?? "").join("");
  return "";
}

/** `"3:45"` / `"1:02:03"` -> seconds. */
export function parseLengthText(value: string | undefined): number {
  if (!value) return 0;
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 1 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) {
    return 0;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function collectVideoRenderers(
  node: unknown,
  out: VideoRenderer[] = [],
): VideoRenderer[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectVideoRenderers(item, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (obj.videoRenderer && typeof obj.videoRenderer === "object") {
    out.push(obj.videoRenderer as VideoRenderer);
  }
  if (
    obj.videoWithContextRenderer &&
    typeof obj.videoWithContextRenderer === "object"
  ) {
    out.push(obj.videoWithContextRenderer as VideoRenderer);
  }
  for (const value of Object.values(obj)) collectVideoRenderers(value, out);
  return out;
}

function thumbnailUrl(renderer: VideoRenderer): string | undefined {
  const thumbs = renderer.thumbnail?.thumbnails?.filter((thumb) => thumb.url) ?? [];
  thumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return thumbs[0]?.url;
}

async function innertubePost(
  endpoint: "search" | "player",
  body: unknown,
  userAgent: string,
  clientName: string,
  clientVersion: string,
): Promise<unknown> {
  const response = await fetch(`${YT_ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: YT_ORIGIN,
      Referer: `${YT_ORIGIN}/`,
      "User-Agent": userAgent,
      "X-YouTube-Client-Name": clientName,
      "X-YouTube-Client-Version": clientVersion,
      ...(endpoint === "player" ? { "X-Goog-Api-Format-Version": "2" } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      `YouTube returned ${response.status} for ${endpoint}.`,
    );
  }

  return response.json();
}

export async function searchYouTubeInnertube(
  query: string,
  options: { maxResults?: number; maxDurationSec?: number } = {},
): Promise<YouTubeSearchResult[]> {
  const maxResults = Math.min(Math.max(options.maxResults ?? 8, 1), 20);
  const maxDurationSec = options.maxDurationSec ?? YOUTUBE_MAX_DURATION_SEC;

  const payload = await innertubePost(
    "search",
    { context: { client: WEB_CLIENT }, query },
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "1",
    WEB_CLIENT.clientVersion,
  );

  const seen = new Set<string>();
  const results: YouTubeSearchResult[] = [];

  for (const renderer of collectVideoRenderers(payload)) {
    const videoId = renderer.videoId;
    const title = textFrom(renderer.title);
    if (!videoId || !title || seen.has(videoId)) continue;
    seen.add(videoId);

    const durationSec = parseLengthText(textFrom(renderer.lengthText));
    if (durationSec > maxDurationSec) continue;

    results.push({
      videoId,
      title,
      channelTitle:
        textFrom(renderer.ownerText) ||
        textFrom(renderer.shortBylineText) ||
        "YouTube",
      thumbnailUrl: thumbnailUrl(renderer),
      durationSec,
      publishedAt: textFrom(renderer.publishedTimeText) || undefined,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });

    if (results.length >= maxResults) break;
  }

  return results;
}

export interface InnertubeAudio {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  thumbnailUrl?: string;
  mimeType: string;
  url: string;
  sizeBytes?: number;
  sampleRate?: number;
  channels?: number;
  bitRate?: number;
}

function extensionFromMime(mimeType: string): "m4a" | "webm" | "mp4" | "audio" {
  if (mimeType.includes("mp4") || mimeType.includes("mp4a")) return "m4a";
  if (mimeType.includes("webm") || mimeType.includes("opus")) return "webm";
  return "audio";
}

function pickAudioFormat(player: PlayerResponse): StreamingFormat | null {
  const formats = [
    ...(player.streamingData?.adaptiveFormats ?? []),
    ...(player.streamingData?.formats ?? []),
  ].filter((format) => format.url && format.mimeType);

  const audioOnly = formats.filter(
    (format) =>
      format.mimeType?.startsWith("audio/") ||
      Boolean(format.audioQuality) ||
      Boolean(format.audioSampleRate),
  );
  const pool = audioOnly.length ? audioOnly : formats;
  pool.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return pool[0] ?? null;
}

export async function getInnertubeAudio(videoId: string): Promise<InnertubeAudio> {
  const payload = (await innertubePost(
    "player",
    {
      context: { client: ANDROID_CLIENT },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
    ANDROID_CLIENT.userAgent,
    "3",
    ANDROID_CLIENT.clientVersion,
  )) as PlayerResponse;

  const status = payload.playabilityStatus?.status ?? "UNKNOWN";
  if (status !== "OK") {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      payload.playabilityStatus?.reason ||
        `YouTube refused playback for that video (${status}).`,
    );
  }

  const details = payload.videoDetails;
  const format = pickAudioFormat(payload);
  if (!details?.videoId || !format?.url || !format.mimeType) {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      "YouTube did not return a downloadable audio stream.",
    );
  }

  return {
    videoId: details.videoId,
    title: details.title || videoId,
    author: details.author || "YouTube",
    durationSec: Number(details.lengthSeconds) || 0,
    thumbnailUrl: details.thumbnail?.thumbnails?.at(-1)?.url,
    mimeType: format.mimeType,
    url: format.url,
    sizeBytes: Number(format.contentLength) || undefined,
    sampleRate: Number(format.audioSampleRate) || undefined,
    channels: format.audioChannels,
    bitRate: format.bitrate,
  };
}

export function innertubeAudioExtension(mimeType: string): string {
  return extensionFromMime(mimeType);
}
