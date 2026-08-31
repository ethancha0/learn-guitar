import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  contentTypeForExtension,
  extensionFromPath,
  inspectMedia,
  safeFileName,
  runTool,
  validateYouTubeVideoIdOrUrl,
  youtubeWatchUrl,
} from "./metadata";
import {
  type DownloadedYouTubeAudio,
  YouTubeToolError,
  YOUTUBE_MAX_DURATION_SEC,
} from "./types";

interface YtDlpInfo {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
}

const AUDIO_FORMAT =
  "ba[ext=m4a][acodec^=mp4a]/ba[ext=m4a]/ba[acodec^=mp4a]/ba[ext=webm]/ba";

async function fetchVideoInfo(videoId: string): Promise<YtDlpInfo> {
  const result = await runTool(
    "yt-dlp",
    [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--ignore-no-formats-error",
      youtubeWatchUrl(videoId),
    ],
    { timeoutMs: 90_000 },
  );

  if (result.code !== 0) {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      "yt-dlp could not read YouTube video metadata.",
      result.stderr,
    );
  }

  try {
    return JSON.parse(result.stdout) as YtDlpInfo;
  } catch {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      "yt-dlp returned invalid video metadata JSON.",
      result.stdout,
    );
  }
}

async function findDownloadedFile(dir: string): Promise<string> {
  const files = await readdir(dir, { withFileTypes: true });
  const candidates = await Promise.all(
    files
      .filter((file) => file.isFile() && !file.name.endsWith(".part"))
      .map(async (file) => {
        const filePath = path.join(dir, file.name);
        return { filePath, size: (await stat(filePath)).size };
      }),
  );
  candidates.sort((a, b) => b.size - a.size);
  if (!candidates[0]) {
    throw new YouTubeToolError(
      "DOWNLOAD_FAILED",
      "yt-dlp finished without writing an audio file.",
    );
  }
  return candidates[0].filePath;
}

async function normalizePlaybackAudio(
  inputPath: string,
  dir: string,
  videoId: string,
): Promise<string> {
  const metadata = await inspectMedia(inputPath);
  const extension = extensionFromPath(inputPath);
  const isAac =
    metadata.codec === "aac" ||
    metadata.codec === "mp4a" ||
    metadata.codec?.startsWith("mp4a") === true;

  if (!isAac) return inputPath;

  const outputPath = path.join(dir, `${videoId}.playback.m4a`);
  const remux = await runTool(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-avoid_negative_ts",
      "make_zero",
      outputPath,
    ],
    { timeoutMs: 120_000 },
  );

  if (remux.code !== 0) {
    if (extension === "m4a" || extension === "mp4") return inputPath;
    throw new YouTubeToolError(
      "INSPECTION_FAILED",
      "FFmpeg could not remux YouTube AAC audio for playback.",
      remux.stderr,
    );
  }

  return outputPath;
}

export async function downloadYouTubeAudio(
  input: string,
  options: { maxDurationSec?: number } = {},
): Promise<DownloadedYouTubeAudio> {
  const videoId = validateYouTubeVideoIdOrUrl(input);
  const maxDurationSec = options.maxDurationSec ?? YOUTUBE_MAX_DURATION_SEC;
  const info = await fetchVideoInfo(videoId);
  const durationSec = Math.round(Number(info.duration) || 0);

  if (durationSec > maxDurationSec) {
    throw new YouTubeToolError(
      "DURATION_TOO_LONG",
      `Video is ${Math.round(durationSec / 60)} minutes long; the current limit is ${Math.round(maxDurationSec / 60)} minutes.`,
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), "yt-download-"));

  try {
    const download = await runTool(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "--paths",
        dir,
        "--output",
        "%(id)s.%(ext)s",
        "--format",
        AUDIO_FORMAT,
        youtubeWatchUrl(videoId),
      ],
      { timeoutMs: 240_000 },
    );

    if (download.code !== 0) {
      throw new YouTubeToolError(
        "DOWNLOAD_FAILED",
        "yt-dlp could not download audio for that video.",
        download.stderr,
      );
    }

    const downloadedPath = await findDownloadedFile(dir);
    const audioPath = await normalizePlaybackAudio(downloadedPath, dir, videoId);
    const extension = extensionFromPath(audioPath);
    const metadata = await inspectMedia(audioPath);
    const sizeBytes = metadata.sizeBytes ?? (await stat(audioPath)).size;
    const title = info.title ?? videoId;
    const uploader = info.uploader ?? info.channel ?? "YouTube";

    return {
      videoId,
      title,
      uploader,
      durationSec: metadata.durationSec || durationSec,
      thumbnailUrl: info.thumbnail,
      path: audioPath,
      fileName: `${safeFileName(title)}-${videoId}.${extension}`,
      extension,
      contentType: contentTypeForExtension(extension),
      sizeBytes,
      metadata,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export async function readDownloadedAudio(
  audio: DownloadedYouTubeAudio,
): Promise<Buffer> {
  return readFile(audio.path);
}
