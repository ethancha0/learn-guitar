/**
 * HTTP front door for the yt-dlp worker.
 *
 *   GET  /health                                  -> { ok, ytDlp, ffmpeg }
 *   GET  /search?q=&maxResults=&maxDurationSec=   -> { results: [...] }
 *   POST /download  { videoId, maxDurationSec }   -> audio bytes + X-Audio-Metadata
 *
 * Every route except /health requires `Authorization: Bearer $YT_WORKER_TOKEN`.
 * Consumed by `lib/youtube/workerClient.ts` in the Next app.
 */

import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { WorkerError, download, run, search, workerConfig } from "./ytdlp.mjs";

const PORT = Number(process.env.PORT) || 8080;
const TOKEN = process.env.YT_WORKER_TOKEN || "";
const ALLOW_ANONYMOUS = process.env.YT_WORKER_ALLOW_ANONYMOUS === "1";
const MAX_BODY_BYTES = 64 * 1024;

if (!TOKEN && !ALLOW_ANONYMOUS) {
  console.error(
    "YT_WORKER_TOKEN is not set. Set it, or set YT_WORKER_ALLOW_ANONYMOUS=1 for local testing.",
  );
  process.exit(1);
}

const STATUS_BY_CODE = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  DURATION_TOO_LONG: 422,
  MISSING_DEPENDENCY: 503,
  BOT_CHECK: 502,
  DOWNLOAD_FAILED: 502,
  INSPECTION_FAILED: 502,
};

/**
 * Cookies arrive as an env var because that is the only secret channel most
 * container hosts offer. Accepts raw Netscape cookie text or base64 of it.
 */
async function materializeCookies() {
  const raw = process.env.YT_DLP_COOKIES;
  if (!raw || process.env.YT_DLP_COOKIES_FILE) return;

  const looksLikeCookieFile = /^#|\t/m.test(raw);
  const contents = looksLikeCookieFile
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  // yt-dlp only reads Netscape format, and several popular browser extensions
  // export JSON by default. Fail here with something actionable rather than
  // letting every request die on yt-dlp's own terse complaint.
  if (!/^#|\t/m.test(contents)) {
    console.error(
      "YT_DLP_COOKIES is not a Netscape cookies.txt file (JSON export?). " +
        "Re-export in Netscape/cookies.txt format. Continuing without cookies.",
    );
    return;
  }

  const dir = path.join(tmpdir(), "yt-worker");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "cookies.txt");
  await writeFile(file, contents.endsWith("\n") ? contents : `${contents}\n`, {
    mode: 0o600,
  });
  process.env.YT_DLP_COOKIES_FILE = file;
  workerConfig().cookiesFile = file;
  console.log("Loaded YouTube cookies from YT_DLP_COOKIES.");
}

function authorize(req) {
  if (ALLOW_ANONYMOUS && !TOKEN) return;
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WorkerError("UNAUTHORIZED", "Invalid or missing worker token.");
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendError(res, err) {
  const isWorkerError = err instanceof WorkerError;
  const code = isWorkerError ? err.code : "INTERNAL";
  const status = STATUS_BY_CODE[code] ?? 500;
  if (!isWorkerError || status >= 500) console.error(`[${code}]`, err);
  sendJson(res, status, {
    error: isWorkerError ? err.message : "Worker request failed.",
    code,
    details: isWorkerError ? err.details : undefined,
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new WorkerError("VALIDATION", "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkerError("VALIDATION", "Expected a JSON request body.");
  }
}

async function handleHealth(res) {
  const config = workerConfig();
  const [ytDlp, ffmpeg] = await Promise.all([
    run(config.ytDlp, ["--version"], { timeoutMs: 15_000 }).catch(() => null),
    run(config.ffmpeg, ["-version"], { timeoutMs: 15_000 }).catch(() => null),
  ]);

  sendJson(res, ytDlp && ffmpeg ? 200 : 503, {
    ok: Boolean(ytDlp && ffmpeg),
    ytDlp: ytDlp?.stdout.trim() || null,
    ffmpeg: ffmpeg?.stdout.split("\n")[0]?.trim() || null,
    cookies: Boolean(config.cookiesFile),
    proxy: Boolean(config.proxy),
  });
}

async function handleSearch(res, url) {
  const results = await search(url.searchParams.get("q") ?? "", {
    maxResults: url.searchParams.get("maxResults"),
    maxDurationSec: url.searchParams.get("maxDurationSec"),
  });
  sendJson(res, 200, { results });
}

async function handleDownload(req, res) {
  const body = await readJsonBody(req);
  const input = body.videoId ?? body.url;
  if (typeof input !== "string") {
    throw new WorkerError("VALIDATION", "Expected `videoId` to be a YouTube video ID or URL.");
  }

  const audio = await download(input, { maxDurationSec: body.maxDurationSec });
  try {
    res.writeHead(200, {
      "Content-Type": audio.meta.contentType,
      "Content-Length": String(audio.meta.sizeBytes),
      "Cache-Control": "no-store",
      // Header-safe transport for the metadata: titles are arbitrary UTF-8.
      "X-Audio-Metadata": Buffer.from(JSON.stringify(audio.meta), "utf8").toString("base64"),
    });
    await pipeline(createReadStream(audio.path), res);
  } finally {
    await audio.cleanup();
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  (async () => {
    if (req.method === "GET" && url.pathname === "/health") {
      return handleHealth(res);
    }

    authorize(req);

    if (req.method === "GET" && url.pathname === "/search") {
      return handleSearch(res, url);
    }
    if (req.method === "POST" && url.pathname === "/download") {
      return handleDownload(req, res);
    }
    sendJson(res, 404, { error: "Not found.", code: "NOT_FOUND" });
  })().catch((err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    sendError(res, err);
  });
});

// Downloads of long videos routinely outlive the 2-minute Node default.
server.requestTimeout = 300_000;
server.headersTimeout = 310_000;
server.keepAliveTimeout = 75_000;

await materializeCookies();

server.listen(PORT, () => {
  console.log(`yt-dlp worker listening on :${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
