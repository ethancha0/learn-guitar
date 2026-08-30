import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * Dev-only offline alignment endpoint.
 *
 *   POST /api/align   (multipart: gp=<file>, audio=<file>, scoreDurationSec=<n>)
 *
 * Runs `align/gp-to-midi.mjs` then `align/align.py` (SyncToolbox MrMsDTW) in a
 * temp dir and returns the `sync.json` document. Disabled in production —
 * alignment is a preprocessing step, not a request-path concern. See
 * `align/README.md` for the Python setup.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const IS_DEV = process.env.NODE_ENV !== "production";
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

export async function POST(request: Request) {
  if (!IS_DEV) {
    return NextResponse.json(
      { status: "failed", message: "Alignment endpoint is disabled in production." },
      { status: 404 },
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
  const scoreDurationSec = Number(form.get("scoreDurationSec")) || undefined;
  const anchorsRaw = form.get("anchors");
  const anchors = typeof anchorsRaw === "string" ? anchorsRaw : undefined;

  const dir = await mkdtemp(path.join(tmpdir(), "align-"));
  const gpPath = path.join(dir, "score.gp");
  const audioPath = path.join(dir, "recording.audio");
  const syncPath = path.join(dir, "sync.json");

  try {
    await writeFile(gpPath, Buffer.from(await gp.arrayBuffer()));
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

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
      audioPath,
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
    return NextResponse.json(doc);
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
