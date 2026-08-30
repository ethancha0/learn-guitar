/**
 * Layer-by-layer measurement of score→audio timing error, offline.
 *
 *   node --experimental-transform-types align/probe-playback.mjs \
 *     --gp align/fixtures/monster/monster.gp \
 *     --bars align/.cache/drift/bars.json \
 *     --sync align/.cache/drift/sync.json \
 *     --out align/.cache/drift/drift.json
 *
 * The player's on-screen "Error" readout cannot say *which* layer is wrong: it
 * compares our `SyncMap` against alphaTab's copy of it while both are moving.
 * This script pulls the four timelines apart and reports each one against the
 * score timeline:
 *
 *   1. GP/alphaTab timing  bars.json vs alphaTab's own tick→millisecond model
 *   2. raw DTW path        sync.json points
 *   3. final sync map      after buildPlaybackSyncMap() + toAlphaTabBarSyncPoints()
 *   4. effective playback  what alphaTab ACTUALLY does with those sync points,
 *                          reproducing MidiFileGenerator._processBarTime* and
 *                          MidiFileSequencer.mainTimePositionFromBackingTrack
 *
 * Layer 4 is the one nothing else measures. It also writes `sync-effective.json`
 * (same shape as `sync.json`) so `evaluate.py` can score real playback against
 * real detected onsets, exactly as it scores the DTW map.
 */
import * as at from "@coderline/alphatab";
import fs from "node:fs";
import path from "node:path";
import {
  SyncMap,
  toAlphaTabBarSyncPoints,
  compensateFlatSyncPoints,
} from "../features/player/data/syncMap.ts";
import { buildPlaybackSyncMap } from "../features/player/data/buildSyncMap.ts";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const gpPath = arg("gp");
const barsPath = arg("bars");
const syncPath = arg("sync");
const outPath = arg("out", "align/.cache/drift/drift.json");
if (!gpPath || !barsPath || !syncPath) {
  console.error("usage: probe-playback.mjs --gp <file> --bars <bars.json> --sync <sync.json> [--out <drift.json>]");
  process.exit(1);
}

const barsDoc = JSON.parse(fs.readFileSync(barsPath, "utf8"));
const syncDoc = JSON.parse(fs.readFileSync(syncPath, "utf8"));
const audioDurationSec =
  Number(arg("audio-duration", syncDoc.recordingDurationSec)) || 0;

const score = at.importer.ScoreLoader.loadScoreFromBytes(
  new Uint8Array(fs.readFileSync(gpPath)),
  new at.Settings(),
);

// --- alphaTab's own tick ↔ millisecond model (the cursor's time base) --------
// MidiFileSequencer.createStateFromFile() accumulates `absTime` in FLOAT
// milliseconds across tempo changes. Rebuild the same table from the generated
// MIDI so we can convert any alphaTab time back to a musical position.
const midi = new at.midi.MidiFile();
const gen = new at.midi.MidiFileGenerator(
  score,
  new at.Settings(),
  new at.midi.AlphaSynthMidiFileHandler(midi),
);
gen.generate();
const division = midi.division;

const tempoChanges = [];
{
  const raw = [];
  for (const mb of gen.tickLookup.masterBars) {
    for (const tc of mb.tempoChanges) raw.push({ ticks: tc.tick, bpm: tc.tempo });
  }
  raw.sort((a, b) => a.ticks - b.ticks);
  let time = 0;
  let prevTick = 0;
  let prevBpm = raw.length ? raw[0].bpm : score.tempo;
  for (const c of raw) {
    time += (c.ticks - prevTick) * (6e4 / (prevBpm * division));
    if (tempoChanges.length && tempoChanges[tempoChanges.length - 1].ticks === c.ticks) {
      tempoChanges[tempoChanges.length - 1].bpm = c.bpm;
    } else {
      tempoChanges.push({ ticks: c.ticks, bpm: c.bpm, time });
    }
    prevTick = c.ticks;
    prevBpm = c.bpm;
  }
  if (!tempoChanges.length) tempoChanges.push({ ticks: 0, bpm: score.tempo, time: 0 });
}

const endTick = gen.tickLookup.masterBars.length
  ? gen.tickLookup.masterBars[gen.tickLookup.masterBars.length - 1].end
  : 0;

function tempoIndexForTick(tick) {
  let i = 0;
  while (i + 1 < tempoChanges.length && tempoChanges[i + 1].ticks <= tick) i++;
  return i;
}
function tempoIndexForTime(ms) {
  let i = 0;
  while (i + 1 < tempoChanges.length && tempoChanges[i + 1].time <= ms) i++;
  return i;
}
/** Exact (float) alphaTab time for a midi tick, in milliseconds. */
function tickToMs(tick) {
  const c = tempoChanges[tempoIndexForTick(tick)];
  return c.time + (tick - c.ticks) * (6e4 / (c.bpm * division));
}
/** MidiFileSequencer.currentTimePositionToTickPosition (int truncation and +1 included). */
function msToTick(ms) {
  const c = tempoChanges[tempoIndexForTime(ms)];
  return c.ticks + (((ms - c.time) / (6e4 / (c.bpm * division))) | 0) + 1;
}
const endTimeMs = tickToMs(endTick);

// --- layer 1: our score timeline vs alphaTab's tick model --------------------
const barTicks = gen.tickLookup.masterBars.map((mb) => mb.start);
const layer1 = barsDoc.bars.map((b, i) => ({
  playbackIndex: b.playbackIndex ?? i,
  barIndex: b.barIndex,
  ourSec: b.startSec,
  alphaTabSec: tickToMs(barTicks[i]) / 1000,
}));
const layer1MaxAbsMs = Math.max(
  ...layer1.map((r) => Math.abs(r.ourSec - r.alphaTabSec) * 1000),
);

// --- layers 2 and 3: raw DTW path → the map the player actually builds -------
// `--grid bars` drops the beat grid, i.e. measures the counterfactual where
// alphaTab is handed one sync point per bar instead of one per beat.
const grid = arg("grid", "beats");
const timeline = {
  bars: barsDoc.bars.map((b) => ({
    barIndex: b.barIndex,
    startSec: b.startSec,
    occurence: b.occurence,
  })),
  endSec: barsDoc.endSec,
  beatSec: grid === "bars" ? undefined : barsDoc.beats,
};

const built = buildPlaybackSyncMap({
  stored: {
    points: syncDoc.points,
    anchors: [],
    method: syncDoc.method,
    status: syncDoc.status,
    scoreEndSec: barsDoc.endSec,
    audioDurationSec,
    diagnostics: syncDoc.diagnostics,
    createdAt: Date.now(),
  },
  offsetMs: 0,
  scoreEndSec: barsDoc.endSec,
  audioDurationSec,
});
const finalMap = built.syncMap;
const rawMap = SyncMap.fromPoints(syncDoc.points, { method: syncDoc.method });
const flat = toAlphaTabBarSyncPoints(finalMap, timeline, { requiredScoreTimes: [] });

// --- layer 4: what alphaTab does with those points ---------------------------
score.applyFlatSyncPoints(flat);
let sps = at.midi.MidiFileGenerator.generateSyncPoints(score);
sps.sort((a, b) => a.synthTick - b.synthTick);

// `--no-compensate` measures the drift as it was before `applySync()` started
// cancelling alphaTab's millisecond truncation.
if (!process.argv.includes("--no-compensate")) {
  const compensated = compensateFlatSyncPoints(flat, sps, finalMap);
  score.applyFlatSyncPoints(compensated);
  sps = at.midi.MidiFileGenerator.generateSyncPoints(score);
  sps.sort((a, b) => a.synthTick - b.synthTick);
}

/** MidiFileSequencer.mainTimePositionFromBackingTrack, playbackSpeed = 1. */
function audioMsToAlphaTabMs(audioMs) {
  if (audioMs < 0 || sps.length === 0) return audioMs;
  let i = 0;
  while (i + 1 < sps.length && sps[i + 1].syncTime <= audioMs) i++;
  const cur = sps[i];
  const diff = audioMs - cur.syncTime;
  if (i + 1 < sps.length) {
    const next = sps[i + 1];
    return cur.synthTime + (next.synthTime - cur.synthTime) * (diff / (next.syncTime - cur.syncTime));
  }
  return cur.synthTime + (endTimeMs - cur.synthTime) * (diff / (audioDurationSec * 1000 - cur.syncTime));
}

// Where the cursor really lands (musical seconds) when the recording is at `audioSec`.
function cursorScoreSec(audioSec) {
  return tickToMs(msToTick(audioMsToAlphaTabMs(audioSec * 1000))) / 1000;
}

// --- per-beat report ---------------------------------------------------------
const beats = barsDoc.beats;
const barStartToIndex = new Map(barsDoc.bars.map((b, i) => [b.startSec.toFixed(6), i]));

const rows = beats.map((s) => {
  const intendedAudio = finalMap.scoreTimeToAudioTime(s);
  const rawAudio = rawMap.scoreTimeToAudioTime(s);
  const alphaTabMs = audioMsToAlphaTabMs(intendedAudio * 1000);
  const landedScoreSec = tickToMs(msToTick(alphaTabMs)) / 1000;
  const barIdx = barStartToIndex.get(s.toFixed(6));
  return {
    scoreSec: Number(s.toFixed(4)),
    bar: barIdx != null ? barsDoc.bars[barIdx].barIndex + 1 : null,
    // layer 3 vs layer 2: did sanitize/simplify/beat-resampling move the curve?
    mapVsRawMs: Number(((intendedAudio - rawAudio) * 1000).toFixed(2)),
    intendedAudioSec: Number(intendedAudio.toFixed(4)),
    // layer 4: alphaTab's reported position vs the score position it should show
    reportedScoreSec: Number((alphaTabMs / 1000).toFixed(4)),
    reportedErrMs: Number((alphaTabMs / 1000 - s) * 1000).toFixed(2) * 1,
    // ... and where the cursor actually draws, in musical seconds
    cursorErrMs: Number(((landedScoreSec - s) * 1000).toFixed(2)),
    // what the player's diagnostics panel prints
    panelErrMs: Number(
      ((finalMap.scoreTimeToAudioTime(alphaTabMs / 1000) - intendedAudio) * 1000).toFixed(2),
    ),
  };
});

// Effective playback map, for evaluate.py: the audio time at which the cursor
// truly reaches each notated position.
const effective = [];
for (const s of beats) {
  const target = s;
  // cursorScoreSec is monotone in audio time; bisect for the audio time that
  // puts the cursor on this beat.
  let lo = 0;
  let hi = audioDurationSec;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (cursorScoreSec(mid) < target) lo = mid;
    else hi = mid;
  }
  const audioTime = (lo + hi) / 2;
  const prev = effective[effective.length - 1];
  if (prev && audioTime <= prev.audioTime) continue;
  effective.push({ scoreTime: Number(target.toFixed(6)), audioTime: Number(audioTime.toFixed(6)) });
}

const outDir = path.dirname(outPath);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "sync-effective.json"),
  JSON.stringify(
    { status: "ok", method: "effective-playback", points: effective, diagnostics: {} },
    null,
    1,
  ),
);

// --- score model verification -------------------------------------------------
const tempoAutomations = [];
for (const mb of score.masterBars) {
  for (const a of mb.tempoAutomations) {
    tempoAutomations.push({ bar: mb.index + 1, ratioPosition: a.ratioPosition, bpm: a.value });
  }
}
const timeSignatures = [];
for (const mb of score.masterBars) {
  const sig = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
  if (!timeSignatures.length || timeSignatures[timeSignatures.length - 1].sig !== sig) {
    timeSignatures.push({ bar: mb.index + 1, sig });
  }
}

const summary = {
  score: {
    title: score.title,
    tempo: score.tempo,
    masterBars: score.masterBars.length,
    playbackBars: gen.tickLookup.masterBars.length,
    hasRepeats: gen.tickLookup.masterBars.length !== score.masterBars.length,
    tempoAutomations,
    timeSignatures,
    division,
    tickShift: midi.tickShift,
    endTick,
    alphaTabEndSec: Number((endTimeMs / 1000).toFixed(6)),
    barsJsonEndSec: barsDoc.endSec,
  },
  layer1: {
    what: "bars.json (float integration) vs alphaTab tick→ms model",
    maxAbsMs: Number(layer1MaxAbsMs.toFixed(3)),
  },
  layer2to3: {
    what: "raw DTW points vs the map the player builds from them",
    maxAbsMs: Number(Math.max(...rows.map((r) => Math.abs(r.mapVsRawMs))).toFixed(2)),
    rawPoints: syncDoc.points.length,
    finalPoints: finalMap.points.length,
    flatPointsToAlphaTab: flat.length,
    repairs: built.repairs,
  },
  layer4: {
    what: "alphaTab's effective mapping vs the map it was given",
    syncPointsGenerated: sps.length,
    firstMs: rows.length ? rows[0].panelErrMs : 0,
    lastMs: rows.length ? rows[rows.length - 1].panelErrMs : 0,
  },
  audioDurationSec,
};

fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 1));

// --- console report ------------------------------------------------------------
const pad = (v, w) => String(v).padStart(w);
console.log(`score: "${summary.score.title}" ${summary.score.tempo} BPM, ` +
  `${summary.score.masterBars} bars → ${summary.score.playbackBars} played ` +
  `(repeats: ${summary.score.hasRepeats}), ${tempoAutomations.length} tempo automation(s), ` +
  `time signatures ${timeSignatures.map((t) => `${t.sig}@${t.bar}`).join(", ")}`);
console.log(`score end: bars.json ${barsDoc.endSec.toFixed(3)}s | alphaTab tick model ${(endTimeMs / 1000).toFixed(3)}s | tickShift ${midi.tickShift}`);
console.log(`layer 1  bars.json vs alphaTab tick model : max ${summary.layer1.maxAbsMs} ms`);
console.log(`layer 2→3 raw DTW vs final map            : max ${summary.layer2to3.maxAbsMs} ms  (${syncDoc.points.length} raw → ${finalMap.points.length} map → ${flat.length} flat points)`);
console.log(`layer 4  alphaTab sync points generated   : ${sps.length}`);
if (built.repairs.length) console.log(`         repairs: ${built.repairs.join("; ")}`);
console.log("");
console.log("score      bar   map−raw   reported−true    cursor−true");
for (let i = 0; i < rows.length; i += Math.max(1, Math.floor(rows.length / 24))) {
  const r = rows[i];
  console.log(
    `${pad(r.scoreSec.toFixed(2), 7)}s ${pad(r.bar ?? "", 5)} ${pad(r.mapVsRawMs.toFixed(1), 8)}ms ` +
    `${pad(r.reportedErrMs.toFixed(1), 13)}ms ${pad(r.cursorErrMs.toFixed(1), 13)}ms`,
  );
}
const last = rows[rows.length - 1];
console.log(`${pad(last.scoreSec.toFixed(2), 7)}s ${pad(last.bar ?? "", 5)} ${pad(last.mapVsRawMs.toFixed(1), 8)}ms ` +
  `${pad(last.reportedErrMs.toFixed(1), 13)}ms ${pad(last.cursorErrMs.toFixed(1), 13)}ms`);
console.log(`\nwrote ${outPath} and ${path.join(outDir, "sync-effective.json")}`);
