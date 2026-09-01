import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffprobePath from "@derhuerst/ffprobe-static";
import ffmpegPath from "ffmpeg-static";
import youtubeDl from "youtube-dl-exec";
import {
  type MediaMetadata,
  type PreparedAlignmentAudio,
  YouTubeToolError,
} from "./types";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const bundledYtDlpPath = (youtubeDl as unknown as {
  constants?: { YOUTUBE_DL_PATH?: string };
}).constants?.YOUTUBE_DL_PATH;

function existingPath(...parts: string[]): string | undefined {
  const candidate = path.join(...parts);
  return existsSync(candidate) ? candidate : undefined;
}

function usablePath(candidate: string | null | undefined): string | undefined {
  if (!candidate) return undefined;
  return path.isAbsolute(candidate) && existsSync(candidate)
    ? candidate
    : undefined;
}

function bundledFfmpegPath(): string | undefined {
  return (
    usablePath(ffmpegPath) ||
    existingPath(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg")
  );
}

function bundledFfprobePath(): string | undefined {
  return (
    usablePath(ffprobePath) ||
    existingPath(
      process.cwd(),
      "node_modules",
      "@derhuerst",
      "ffprobe-static",
      "ffprobe",
    )
  );
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface FFprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
    size?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    duration?: string;
    sample_rate?: string;
    channels?: number;
    bit_rate?: string;
  }>;
}

export function validateYouTubeVideoIdOrUrl(value: string): string {
  const raw = value.trim();
  if (YOUTUBE_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new YouTubeToolError(
      "VALIDATION",
      "Enter a valid YouTube video ID or URL.",
    );
  }

  const host = url.hostname.replace(/^www\./, "");
  if (
    !["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(
      host,
    )
  ) {
    throw new YouTubeToolError(
      "VALIDATION",
      "Only YouTube video URLs are supported.",
    );
  }

  if (url.searchParams.has("list") || url.pathname.startsWith("/playlist")) {
    throw new YouTubeToolError("VALIDATION", "Playlists are not supported yet.");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  const candidate =
    host === "youtu.be"
      ? pathParts[0]
      : url.searchParams.get("v") ??
        (["shorts", "embed", "live"].includes(pathParts[0]) ? pathParts[1] : "");

  if (!candidate || !YOUTUBE_ID_RE.test(candidate)) {
    throw new YouTubeToolError(
      "VALIDATION",
      "Enter a valid YouTube video ID or URL.",
    );
  }

  return candidate;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${validateYouTubeVideoIdOrUrl(videoId)}`;
}

export function extensionFromPath(filePath: string): string {
  return path.extname(filePath).replace(/^\./, "").toLowerCase() || "audio";
}

export function contentTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "webm":
      return "audio/webm";
    case "mp3":
      return "audio/mpeg";
    case "opus":
      return "audio/ogg";
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

function resolveToolCommand(command: string): string {
  switch (command) {
    case "yt-dlp":
      return process.env.YT_DLP_PATH || process.env.YOUTUBE_DL_PATH || bundledYtDlpPath || command;
    case "ffmpeg":
      return (
        process.env.FFMPEG_PATH ||
        process.env.FFMPEG_BIN ||
        bundledFfmpegPath() ||
        command
      );
    case "ffprobe":
      return (
        process.env.FFPROBE_PATH ||
        process.env.FFPROBE_BIN ||
        bundledFfprobePath() ||
        command
      );
    default:
      return command;
  }
}

export function safeFileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "youtube-audio"
  );
}

export function runTool(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const resolvedCommand = resolveToolCommand(command);

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new YouTubeToolError(
          "DOWNLOAD_FAILED",
          `${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new YouTubeToolError(
            "MISSING_DEPENDENCY",
            `${command} is not installed, bundled, or available on PATH.`,
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function inspectMedia(filePath: string): Promise<MediaMetadata> {
  const result = await runTool("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    filePath,
  ]);

  if (result.code !== 0) {
    throw new YouTubeToolError(
      "INSPECTION_FAILED",
      "ffprobe could not inspect the downloaded audio.",
      result.stderr,
    );
  }

  let data: FFprobeOutput;
  try {
    data = JSON.parse(result.stdout) as FFprobeOutput;
  } catch {
    throw new YouTubeToolError(
      "INSPECTION_FAILED",
      "ffprobe returned invalid JSON.",
      result.stdout,
    );
  }

  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio) {
    throw new YouTubeToolError(
      "INSPECTION_FAILED",
      "The downloaded file does not contain an audio stream.",
    );
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  const probedSize = Number(data.format?.size) || undefined;
  return {
    durationSec: Number(audio.duration ?? data.format?.duration) || 0,
    container: data.format?.format_name,
    codec: audio.codec_name,
    sampleRate: Number(audio.sample_rate) || undefined,
    channels: audio.channels,
    bitRate: Number(audio.bit_rate ?? data.format?.bit_rate) || undefined,
    sizeBytes: fileStat?.size ?? probedSize,
  };
}

export async function prepareAudioForAlignment(
  file: Blob | string | { path: string },
  options: { workDir?: string; inputName?: string } = {},
): Promise<PreparedAlignmentAudio> {
  const ownsDir = !options.workDir;
  const dir =
    options.workDir ?? (await mkdtemp(path.join(tmpdir(), "yt-audio-")));
  const inputPath =
    typeof file === "string"
      ? file
      : "path" in file
        ? file.path
        : path.join(dir, options.inputName ?? "recording.input");
  const wavPath = path.join(dir, "recording.alignment.wav");

  if (typeof file !== "string" && !("path" in file)) {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
  }

  try {
    const source = await inspectMedia(inputPath);
    const convert = await runTool(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-sample_fmt",
        "s16",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ],
      { timeoutMs: 180_000 },
    );

    if (convert.code !== 0) {
      throw new YouTubeToolError(
        "INSPECTION_FAILED",
        "FFmpeg could not create the alignment WAV.",
        convert.stderr,
      );
    }

    const wav = await inspectMedia(wavPath);
    return {
      wavPath,
      source,
      wav,
      cleanup: () => {
        if (ownsDir) return rm(dir, { recursive: true, force: true });
        return rm(wavPath, { force: true });
      },
    };
  } catch (err) {
    if (ownsDir) await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
