/**
 * Locate yt-dlp / ffmpeg / ffprobe for both local dev and serverless.
 *
 * `youtube-dl-exec` ships a Python zipapp. That works on a Mac with Homebrew
 * Python, but Vercel has no `python3`, and Next's function trace usually omits
 * `node_modules/.../bin/yt-dlp` anyway. When no usable binary is on disk we
 * download the official platform standalone (self-contained, no Python) into
 * the writable temp dir and reuse it for the rest of the instance.
 */

import { createRequire } from "node:module";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { chmod, copyFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffprobePath from "@derhuerst/ffprobe-static";
import ffmpegPath from "ffmpeg-static";
import { YouTubeToolError } from "./types";

const requireFromHere = createRequire(import.meta.url);

/** Pin so production does not surprise-break on a `latest` asset rename. */
export const YT_DLP_RELEASE = "2026.08.19";

function packageFile(pkg: string, ...relativePath: string[]): string | undefined {
  try {
    const candidate = path.join(
      path.dirname(requireFromHere.resolve(`${pkg}/package.json`)),
      ...relativePath,
    );
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function firstExisting(
  ...candidates: Array<string | undefined | null>
): string | undefined {
  return candidates.find((value): value is string => Boolean(value && existsSync(value)));
}

function hasPython(): boolean {
  return [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "/bin/python3",
  ].some((candidate) => existsSync(candidate));
}

/** The npm zipapp starts with a python shebang; Vercel cannot exec that. */
export function isPythonZipapp(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(80);
    const bytesRead = readSync(fd, buf, 0, 80, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    return head.startsWith("#!") && /python/i.test(head);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function isUsableBinary(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  if (isPythonZipapp(filePath) && !hasPython()) return false;
  return true;
}

export function standaloneYtDlpAsset(): { fileName: string; url: string } {
  const version = process.env.YT_DLP_VERSION || YT_DLP_RELEASE;
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`;
  if (process.platform === "win32") {
    return { fileName: "yt-dlp.exe", url: `${base}/yt-dlp.exe` };
  }
  if (process.platform === "darwin") {
    return { fileName: "yt-dlp_macos", url: `${base}/yt-dlp_macos` };
  }
  const fileName =
    process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return { fileName, url: `${base}/${fileName}` };
}

function bundledYtDlpPath(): string | undefined {
  const file = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  return firstExisting(
    path.join(process.cwd(), "vendor", "media", file),
    path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", file),
    packageFile("youtube-dl-exec", "bin", file),
  );
}

function bundledFfmpegPath(): string | undefined {
  const file = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return firstExisting(
    process.env.FFMPEG_PATH,
    process.env.FFMPEG_BIN,
    typeof ffmpegPath === "string" ? ffmpegPath : undefined,
    packageFile("ffmpeg-static", file),
  );
}

function bundledFfprobePath(): string | undefined {
  const file = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return firstExisting(
    process.env.FFPROBE_PATH,
    process.env.FFPROBE_BIN,
    typeof ffprobePath === "string" ? ffprobePath : undefined,
    packageFile("@derhuerst/ffprobe-static", file),
  );
}

/** Sync lookup used by tests and as the first pass before a download. */
export function resolveToolCommand(command: string): string {
  switch (command) {
    case "yt-dlp": {
      const found = firstExisting(
        process.env.YT_DLP_PATH,
        process.env.YOUTUBE_DL_PATH,
        bundledYtDlpPath(),
      );
      return found && isUsableBinary(found) ? found : command;
    }
    case "ffmpeg":
      return bundledFfmpegPath() ?? command;
    case "ffprobe":
      return bundledFfprobePath() ?? command;
    default:
      return command;
  }
}

/** True when a runnable yt-dlp is already on disk. Does not download one. */
export function hasLocalYtDlp(): boolean {
  return resolveToolCommand("yt-dlp") !== "yt-dlp";
}

async function makeExecutable(src: string): Promise<string> {
  try {
    await chmod(src, 0o755);
    return src;
  } catch {
    const dest = path.join(tmpdir(), path.basename(src));
    await copyFile(src, dest);
    await chmod(dest, 0o755);
    return dest;
  }
}

let ytDlpDownload: Promise<string> | undefined;

async function downloadStandaloneYtDlp(): Promise<string> {
  const { fileName, url } = standaloneYtDlpAsset();
  const dest = path.join(tmpdir(), fileName);
  if (existsSync(dest)) {
    await chmod(dest, 0o755).catch(() => undefined);
    return dest;
  }

  const headers: Record<string, string> = {
    "User-Agent": "learn-bass-yt-dlp-bootstrap",
    Accept: "application/octet-stream",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new YouTubeToolError(
      "MISSING_DEPENDENCY",
      `Could not download yt-dlp (${response.status} from ${url}).`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength < 1_000_000) {
    throw new YouTubeToolError(
      "MISSING_DEPENDENCY",
      "Downloaded yt-dlp binary was unexpectedly small.",
    );
  }

  const part = `${dest}.part`;
  await writeFile(part, bytes);
  await chmod(part, 0o755);
  await rename(part, dest);
  return dest;
}

function ensureStandaloneYtDlp(): Promise<string> {
  ytDlpDownload ??= downloadStandaloneYtDlp().catch((err) => {
    ytDlpDownload = undefined;
    throw err;
  });
  return ytDlpDownload;
}

/**
 * Resolve a tool path, downloading a standalone yt-dlp into /tmp when the
 * serverless bundle does not include a runnable copy.
 */
export async function ensureToolCommand(command: string): Promise<string> {
  const resolved = resolveToolCommand(command);
  if (resolved !== command && isUsableBinary(resolved)) {
    return makeExecutable(resolved);
  }
  if (command === "yt-dlp") {
    return ensureStandaloneYtDlp();
  }
  return resolved;
}
