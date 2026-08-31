/**
 * yt-dlp/ffmpeg wrappers for the worker.
 *
 * Deliberately dependency-free and self-contained: this service is deployed as
 * its own container, so it does not share code with the Next app. The response
 * shapes here are the contract consumed by `lib/youtube/workerClient.ts`.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const AUDIO_FORMAT =
  "ba[ext=m4a][acodec^=mp4a]/ba[ext=m4a]/ba[acodec^=mp4a]/ba[ext=webm]/ba";

export class WorkerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.details = details;
  }
}

const config = {
  ytDlp: process.env.YT_DLP_PATH || "yt-dlp",
  ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  proxy: process.env.YT_DLP_PROXY || "",
  cookiesFile: process.env.YT_DLP_COOKIES_FILE || "",
  extractorArgs: process.env.YT_DLP_EXTRACTOR_ARGS || "",
  maxDurationSec: Number(process.env.MAX_DURATION_SEC) || 15 * 60,
};

export function workerConfig() {
  return config;
}

/**
 * Flags every yt-dlp invocation needs. `--proxy` and `--cookies` are the two
 * levers that get you past YouTube's "confirm you're not a bot" check when the
 * host IP has a poor reputation.
 */
function commonYtDlpArgs() {
  const args = ["--no-warnings", "--no-progress", "--no-playlist"];
  if (config.proxy) args.push("--proxy", config.proxy);
  if (config.cookiesFile) args.push("--cookies", config.cookiesFile);
  if (config.extractorArgs) args.push("--extractor-args", config.extractorArgs);
  return args;
}

export function validateVideoId(value) {
  const raw = String(value ?? "").trim();
  if (YOUTUBE_ID_RE.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new WorkerError("VALIDATION", "Enter a valid YouTube video ID or URL.");
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    throw new WorkerError("VALIDATION", "Only YouTube video URLs are supported.");
  }
  if (url.searchParams.has("list") || url.pathname.startsWith("/playlist")) {
    throw new WorkerError("VALIDATION", "Playlists are not supported yet.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const candidate =
    host === "youtu.be"
      ? parts[0]
      : (url.searchParams.get("v") ??
        (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : ""));

  if (!candidate || !YOUTUBE_ID_RE.test(candidate)) {
    throw new WorkerError("VALIDATION", "Enter a valid YouTube video ID or URL.");
  }
  return candidate;
}

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${validateVideoId(videoId)}`;
}

export function extensionFromPath(filePath) {
  return path.extname(filePath).replace(/^\./, "").toLowerCase() || "audio";
}

export function contentTypeForExtension(extension) {
  switch (extension.toLowerCase()) {
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "webm":
      return "audio/webm";
    case "mp3":
      return "audio/mpeg";
    case "opus":
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

export function safeFileName(value) {
  return (
    String(value)
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "youtube-audio"
  );
}

export function run(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new WorkerError(
            "MISSING_DEPENDENCY",
            `${command} is not installed or not on PATH inside the worker image.`,
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new WorkerError(
            "DOWNLOAD_FAILED",
            `${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          ),
        );
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * yt-dlp's bot-check failure is the single most likely production error, so
 * surface it as its own code instead of a generic download failure.
 */
function downloadError(message, stderr) {
  if (/confirm (?:that )?you'?re not a bot|Sign in to confirm/i.test(stderr ?? "")) {
    return new WorkerError(
      "BOT_CHECK",
      "YouTube is blocking this server's IP. Configure YT_DLP_COOKIES or YT_DLP_PROXY on the worker.",
      stderr,
    );
  }
  return new WorkerError("DOWNLOAD_FAILED", message, stderr);
}

export async function inspectMedia(filePath) {
  const result = await run(config.ffprobe, [
    "-v", "error",
    "-show_format",
    "-show_streams",
    "-of", "json",
    filePath,
  ]);

  if (result.code !== 0) {
    throw new WorkerError(
      "INSPECTION_FAILED",
      "ffprobe could not inspect the downloaded audio.",
      result.stderr,
    );
  }

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new WorkerError("INSPECTION_FAILED", "ffprobe returned invalid JSON.", result.stdout);
  }

  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio) {
    throw new WorkerError(
      "INSPECTION_FAILED",
      "The downloaded file does not contain an audio stream.",
    );
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  return {
    durationSec: Number(audio.duration ?? data.format?.duration) || 0,
    container: data.format?.format_name,
    codec: audio.codec_name,
    sampleRate: Number(audio.sample_rate) || undefined,
    channels: audio.channels,
    bitRate: Number(audio.bit_rate ?? data.format?.bit_rate) || undefined,
    sizeBytes: fileStat?.size ?? (Number(data.format?.size) || undefined),
  };
}

function bestThumbnail(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  return entry.thumbnails
    ?.filter((thumbnail) => thumbnail.url)
    .sort(
      (a, b) =>
        (b.preference ?? 0) - (a.preference ?? 0) || (b.width ?? 0) - (a.width ?? 0),
    )[0]?.url;
}

function publishedAtFromUploadDate(value) {
  if (!value) return undefined;
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

function toSearchResult(entry) {
  if (!entry?.id || !entry?.title) return null;
  let videoId;
  try {
    videoId = validateVideoId(entry.id);
  } catch {
    return null;
  }
  return {
    videoId,
    title: entry.title || safeFileName(videoId),
    channelTitle: entry.uploader ?? entry.channel ?? "YouTube",
    thumbnailUrl: bestThumbnail(entry),
    durationSec: Math.round(Number(entry.duration) || 0),
    publishedAt: publishedAtFromUploadDate(entry.upload_date),
    url: watchUrl(videoId),
  };
}

export async function search(query, { maxResults = 8, maxDurationSec } = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new WorkerError("VALIDATION", "Search query is required.");
  if (q.length > 200) {
    throw new WorkerError("VALIDATION", "Search query must be 200 characters or fewer.");
  }

  const limit = Math.min(Math.max(Number(maxResults) || 8, 1), 20);
  const durationCap = Number(maxDurationSec) || config.maxDurationSec;

  // `--flat-playlist` keeps this to one search request instead of a full
  // metadata fetch per hit: ~4x faster, and far fewer requests for YouTube to
  // bot-check. The cost is `upload_date`, so worker-backed results carry no
  // `publishedAt`; the import UI already renders that field conditionally.
  const result = await run(
    config.ytDlp,
    [
      ...commonYtDlpArgs(),
      "--dump-single-json",
      "--flat-playlist",
      "--skip-download",
      "--ignore-no-formats-error",
      `ytsearch${limit}:${q}`,
    ],
    { timeoutMs: 90_000 },
  );

  if (result.code !== 0) {
    throw downloadError("yt-dlp could not search YouTube.", result.stderr);
  }

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new WorkerError("DOWNLOAD_FAILED", "yt-dlp returned invalid search JSON.", result.stdout);
  }

  return (data.entries ?? [])
    .map(toSearchResult)
    .filter(Boolean)
    .filter((entry) => entry.durationSec > 0 && entry.durationSec <= durationCap)
    .slice(0, limit);
}

async function fetchVideoInfo(videoId) {
  const result = await run(
    config.ytDlp,
    [
      ...commonYtDlpArgs(),
      "--dump-single-json",
      "--skip-download",
      "--ignore-no-formats-error",
      watchUrl(videoId),
    ],
    { timeoutMs: 90_000 },
  );

  if (result.code !== 0) {
    throw downloadError("yt-dlp could not read YouTube video metadata.", result.stderr);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new WorkerError(
      "DOWNLOAD_FAILED",
      "yt-dlp returned invalid video metadata JSON.",
      result.stdout,
    );
  }
}

async function findDownloadedFile(dir) {
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
    throw new WorkerError("DOWNLOAD_FAILED", "yt-dlp finished without writing an audio file.");
  }
  return candidates[0].filePath;
}

/**
 * Remux AAC into a clean faststart .m4a with stream copy. This keeps browser
 * playback time-origin consistent with the WAV that DTW alignment decodes; see
 * docs/youtube-import-pipeline.md.
 */
async function normalizePlaybackAudio(inputPath, dir, videoId) {
  const metadata = await inspectMedia(inputPath);
  const extension = extensionFromPath(inputPath);
  const isAac =
    metadata.codec === "aac" ||
    metadata.codec === "mp4a" ||
    metadata.codec?.startsWith("mp4a") === true;

  if (!isAac) return inputPath;

  const outputPath = path.join(dir, `${videoId}.playback.m4a`);
  const remux = await run(
    config.ffmpeg,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-map", "0:a:0",
      "-vn",
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-avoid_negative_ts", "make_zero",
      outputPath,
    ],
    { timeoutMs: 120_000 },
  );

  if (remux.code !== 0) {
    if (extension === "m4a" || extension === "mp4") return inputPath;
    throw new WorkerError(
      "INSPECTION_FAILED",
      "FFmpeg could not remux YouTube AAC audio for playback.",
      remux.stderr,
    );
  }

  return outputPath;
}

/**
 * Downloads audio into a temp dir. The caller owns `cleanup()` and must call it
 * once the file has been streamed to the client.
 */
export async function download(input, { maxDurationSec } = {}) {
  const videoId = validateVideoId(input);
  const durationCap = Number(maxDurationSec) || config.maxDurationSec;
  const info = await fetchVideoInfo(videoId);
  const infoDurationSec = Math.round(Number(info.duration) || 0);

  if (infoDurationSec > durationCap) {
    throw new WorkerError(
      "DURATION_TOO_LONG",
      `Video is ${Math.round(infoDurationSec / 60)} minutes long; the current limit is ${Math.round(durationCap / 60)} minutes.`,
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), "yt-download-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });

  try {
    const result = await run(
      config.ytDlp,
      [
        ...commonYtDlpArgs(),
        "--paths", dir,
        "--output", "%(id)s.%(ext)s",
        "--format", AUDIO_FORMAT,
        watchUrl(videoId),
      ],
      { timeoutMs: 240_000 },
    );

    if (result.code !== 0) {
      throw downloadError("yt-dlp could not download audio for that video.", result.stderr);
    }

    const downloadedPath = await findDownloadedFile(dir);
    const audioPath = await normalizePlaybackAudio(downloadedPath, dir, videoId);
    const extension = extensionFromPath(audioPath);
    const metadata = await inspectMedia(audioPath);
    const title = info.title ?? videoId;

    return {
      path: audioPath,
      cleanup,
      meta: {
        videoId,
        title,
        uploader: info.uploader ?? info.channel ?? "YouTube",
        durationSec: metadata.durationSec || infoDurationSec,
        thumbnailUrl: info.thumbnail ?? undefined,
        fileName: `${safeFileName(title)}-${videoId}.${extension}`,
        extension,
        contentType: contentTypeForExtension(extension),
        sizeBytes: metadata.sizeBytes ?? (await stat(audioPath)).size,
        metadata,
      },
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
