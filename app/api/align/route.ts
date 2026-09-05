import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { prepareAudioForAlignment } from "@/lib/youtube/metadata";
import {
  alignMode,
  resolveAlignProvider,
  type AlignWorkerConfig,
} from "@/lib/align/provider";

/**
 * Dev-only offline alignment endpoint.
 *
 *   POST /api/align   (multipart: gp=<file>, audio=<file>, scoreDurationSec=<n>)
 *
 * Runs `align/gp-to-midi.mjs` then `align/align.py` (SyncToolbox MrMsDTW) in a
 * temp dir and returns the `sync.json` document.
 *
 * Where that work happens depends on the host: locally it spawns node + python
 * directly, and on a runtime with no Python it proxies the same request to an
 * align worker (`ALIGN_WORKER_URL`). See `lib/align/provider.ts`, and
 * `align/README.md` for the Python setup.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const PYTHON = process.env.ALIGN_PYTHON || "python3";
const TIMEOUT_MS = 240_000;

function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Hands the request to the align worker unchanged. The worker runs the same
 * two steps against the same `sync.json` contract, so its response is passed
 * straight back rather than reshaped here.
 */
async function proxyToWorker(
  config: AlignWorkerConfig,
  form: FormData,
): Promise<Response> {
  try {
    const res = await fetch(`${config.baseUrl}/align`, {
      method: "POST",
      body: form,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        stage: "worker",
        message: `Align worker unreachable: ${(err as Error).message}`,
      },
      { status: 502 },
    );
  }
}

/**
 * How this deployment can align, so the client knows what to send. Cheap and
 * side-effect free; the browser caches the answer for the session.
 */
export async function GET() {
  const provider = resolveAlignProvider();
  return NextResponse.json({
    mode: alignMode(provider),
    message: provider.kind === "unavailable" ? provider.message : undefined,
  });
}

export async function POST(request: Request) {
  const provider = resolveAlignProvider();
  if (provider.kind === "unavailable") {
    return NextResponse.json(
      { status: "failed", stage: "config", message: provider.message },
      { status: 501 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { status: "failed", message: "Expected multipart/form-data." },
      { status: 400 },
    );
  }

  const gp = form.get("gp");
  const audio = form.get("audio");
  if (!(gp instanceof Blob) || !(audio instanceof Blob)) {
    return NextResponse.json(
      { status: "failed", message: "Both `gp` and `audio` files are required." },
      { status: 400 },
    );
  }
  if (provider.kind === "worker") {
    return proxyToWorker(provider.config, form);
  }

  if (provider.kind === "dispatch") {
    return NextResponse.json(
      {
        status: "failed",
        stage: "config",
        message:
          "This deployment aligns by GitHub Action. POST { songId } to " +
          "/api/align/dispatch instead of uploading the files here.",
      },
      { status: 409 },
    );
  }

  const scoreDurationSec = Number(form.get("scoreDurationSec")) || undefined;
  const anchorsRaw = form.get("anchors");
  const anchors = typeof anchorsRaw === "string" ? anchorsRaw : undefined;

  const dir = await mkdtemp(path.join(tmpdir(), "align-"));
  const gpPath = path.join(dir, "score.gp");
  const syncPath = path.join(dir, "sync.json");

  try {
    await writeFile(gpPath, Buffer.from(await gp.arrayBuffer()));
    const preparedAudio = await prepareAudioForAlignment(audio, {
      workDir: dir,
      inputName: "recording.input",
    });

    const gpToMidi = await run("node", ["align/gp-to-midi.mjs", gpPath, dir]);
    if (gpToMidi.code !== 0) {
      return NextResponse.json(
        {
          status: "failed",
          stage: "gp-to-midi",
          message: parseMessage(gpToMidi.stdout, gpToMidi.stderr) ?? "GP → MIDI failed.",
        },
        { status: 422 },
      );
    }

    const args = [
      "align/align.py",
      "--recording",
      preparedAudio.wavPath,
      "--midi",
      path.join(dir, "score.mid"),
      "--bars",
      path.join(dir, "bars.json"),
      "--out",
      syncPath,
    ];
    if (scoreDurationSec) args.push("--score-duration-sec", String(scoreDurationSec));
    if (anchors) args.push("--anchors", anchors);
    // Pass the soundfont explicitly rather than relying on align.py reading the
    // env var. Without one the script silently falls back to the pretty_midi
    // sine renderer, which renders drum tracks as silence and has no attack
    // transients — measurably the largest single source of alignment error.
    if (process.env.ALIGN_SOUNDFONT) {
      args.push("--soundfont", process.env.ALIGN_SOUNDFONT);
    }

    const align = await run(PYTHON, args);

    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(syncPath, "utf8"));
    } catch {
      return NextResponse.json(
        {
          status: "failed",
          stage: "align",
          message:
            parseMessage(align.stdout, align.stderr) ??
            `align.py exited ${align.code} without writing sync.json. Check align/README.md setup.`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(withAudioDiagnostics(doc, preparedAudio));
  } catch (err) {
    return NextResponse.json(
      { status: "failed", message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

function parseMessage(stdout: string, stderr: string): string | undefined {
  for (const line of [...stdout.split("\n").reverse(), ...stderr.split("\n").reverse()]) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        const j = JSON.parse(trimmed);
        if (typeof j.message === "string") return j.message;
      } catch {
        /* keep looking */
      }
    }
  }
  return stderr.trim().split("\n").slice(-3).join(" ") || undefined;
}

function withAudioDiagnostics(
  doc: unknown,
  audio: Awaited<ReturnType<typeof prepareAudioForAlignment>>,
): unknown {
  if (!doc || typeof doc !== "object") return doc;
  const current = doc as {
    diagnostics?: Record<string, unknown>;
  };
  return {
    ...current,
    diagnostics: {
      ...current.diagnostics,
      sourceAudio: audio.source,
      alignmentAudio: audio.wav,
    },
  };
}
