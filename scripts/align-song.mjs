#!/usr/bin/env node
/**
 * Aligns one song on a CI runner and writes the map back to Supabase.
 *
 * Invoked by `.github/workflows/align-song.yml`, which is triggered by the
 * app's `/api/align/dispatch` route. Nothing is uploaded to the runner: it
 * pulls the tab and recording out of Supabase storage by song id, runs the
 * same two steps `/api/align` runs locally, and PATCHes `songs.sync_map`.
 *
 *   node scripts/align-song.mjs <songId>
 *
 * Environment:
 *   SUPABASE_URL                 project URL
 *   SUPABASE_SERVICE_ROLE_KEY    service role — bypasses RLS, so this script
 *                                can reach any user's song by id alone
 *   ALIGN_SOUNDFONT              GM soundfont for the reference render
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const BUCKET = "song-files";
const PYTHON = process.env.ALIGN_PYTHON || "python3";

const songId = process.argv[2];
if (!songId) {
  console.error("usage: align-song.mjs <songId>");
  process.exit(2);
}

const SUPABASE_URL = required("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable ${name}.`);
    process.exit(2);
  }
  return value;
}

function authHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function fetchRow() {
  const url =
    `${SUPABASE_URL}/rest/v1/songs?id=eq.${encodeURIComponent(songId)}` +
    `&select=id,title,tab_path,audio_path,sync_map`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Could not read song ${songId}: ${res.status} ${await res.text()}`);
  }
  const [row] = await res.json();
  if (!row) throw new Error(`No song row with id ${songId}.`);
  return row;
}

async function download(storagePath, destination) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Could not download ${storagePath}: ${res.status}`);
  }
  await writeFile(destination, Buffer.from(await res.arrayBuffer()));
  return destination;
}

/**
 * Converts the recording to the mono 22.05 kHz s16 WAV align.py expects, with
 * the same ffmpeg call `/api/align` makes locally (`prepareAudioForAlignment`
 * in lib/youtube/metadata.ts) and the same bundled binary, so a map solved here
 * matches one solved on a dev machine.
 *
 * Handing align.py the raw download instead only works for formats libsndfile
 * can open. A YouTube-sourced m4a or webm falls through to audioread, which
 * needs a decoder that is not there, and the whole run dies on "could not
 * decode audio". Converting up front removes the guesswork for every format.
 */
async function toAlignmentWav(inputPath, dir) {
  const wavPath = path.join(dir, "recording.alignment.wav");
  // ffmpeg-static resolves to a path whether or not its postinstall actually
  // fetched the binary, so check before trusting it and fall back to PATH.
  const ffmpeg =
    ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg";
  const convert = await run(ffmpeg, [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", inputPath,
    "-vn",
    "-ac", "1",
    "-ar", "22050",
    "-sample_fmt", "s16",
    "-c:a", "pcm_s16le",
    wavPath,
  ]);
  if (convert.code !== 0) {
    throw new Error(
      `ffmpeg could not decode ${path.basename(inputPath)} (exit ${convert.code}). ` +
        (convert.stderr.trim().split("\n").slice(-3).join(" ") || ""),
    );
  }
  return wavPath;
}

async function saveSyncMap(map) {
  const url = `${SUPABASE_URL}/rest/v1/songs?id=eq.${encodeURIComponent(songId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ sync_map: map }),
  });
  if (!res.ok) {
    throw new Error(`Could not save the map: ${res.status} ${await res.text()}`);
  }
}

const dir = await mkdtemp(path.join(tmpdir(), "align-"));
try {
  const row = await fetchRow();
  console.log(`Aligning "${row.title}" (${songId})`);

  const [gpPath, downloadedAudio] = await Promise.all([
    download(row.tab_path, path.join(dir, "score.gp")),
    download(row.audio_path, path.join(dir, path.basename(row.audio_path))),
  ]);

  const audioPath = await toAlignmentWav(downloadedAudio, dir);

  const gpToMidi = await run("node", ["align/gp-to-midi.mjs", gpPath, dir]);
  if (gpToMidi.code !== 0) {
    throw new Error(`gp-to-midi failed (exit ${gpToMidi.code}).`);
  }

  const syncPath = path.join(dir, "sync.json");
  const args = [
    "align/align.py",
    "--recording", audioPath,
    "--midi", path.join(dir, "score.mid"),
    "--bars", path.join(dir, "bars.json"),
    "--out", syncPath,
  ];
  // Without a soundfont align.py falls back to a sine renderer that aligns
  // measurably worse, so treat a missing one as a setup error, not a default.
  if (process.env.ALIGN_SOUNDFONT) {
    args.push("--soundfont", process.env.ALIGN_SOUNDFONT);
  } else {
    console.warn("ALIGN_SOUNDFONT is not set — falling back to the sine renderer.");
  }

  const aligned = await run(PYTHON, args);
  let doc;
  try {
    doc = JSON.parse(await readFile(syncPath, "utf8"));
  } catch {
    throw new Error(`align.py exited ${aligned.code} without writing sync.json.`);
  }

  if (doc.status === "failed" || !Array.isArray(doc.points) || doc.points.length < 2) {
    throw new Error(doc.message ?? "Alignment produced no usable mapping.");
  }

  await saveSyncMap({
    points: doc.points,
    // Manual corrections made in the app outlive a re-run.
    anchors: row.sync_map?.anchors ?? undefined,
    method: doc.method ?? "dtw:mrmsdtw",
    status: doc.status === "low-confidence" ? "low-confidence" : "ok",
    scoreEndSec: doc.scoreDurationSec ?? undefined,
    audioDurationSec: doc.recordingDurationSec ?? undefined,
    diagnostics: doc.diagnostics ?? undefined,
    createdAt: Date.now(),
  });

  console.log(`Saved ${doc.points.length} points via ${doc.method ?? "dtw"}.`);
} catch (err) {
  console.error(`Alignment failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
