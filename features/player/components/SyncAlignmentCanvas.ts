"use client";

import type { SyncAnchor } from "@/features/library/data/songStore";
import type { OnsetHit } from "@/features/player/data/onsetDetect";
import type { Peaks } from "@/features/player/data/waveform";
import type { SynthNote } from "@/features/player/data/trackSynth";
import type { SyncMap } from "@/features/player/data/syncMap";

/**
 * GoPlayAlong-style alignment stack: three rows sharing one audio-time x axis.
 *
 *   1. sync points — numbered, draggable anchors
 *   2. tab         — the track's fret numbers drawn at their *mapped audio time*
 *   3. waveform    — the recording
 *
 * Alignment is judged by eye: a fret number should sit directly above the
 * attack it belongs to. Nothing else belongs in this picture.
 */

export const ANCHOR_RAIL_H = 34;
export const WAVE_H = 150;
const TAB_PAD = 18;
const STRING_GAP = 15;

export interface AlignmentLayout {
  anchorTop: number;
  anchorH: number;
  tabTop: number;
  tabH: number;
  waveTop: number;
  waveH: number;
  total: number;
  stringCount: number;
}

export function alignmentLayout(stringCount: number): AlignmentLayout {
  const strings = Math.max(1, stringCount);
  const tabH = TAB_PAD * 2 + (strings - 1) * STRING_GAP;
  return {
    anchorTop: 0,
    anchorH: ANCHOR_RAIL_H,
    tabTop: ANCHOR_RAIL_H,
    tabH,
    waveTop: ANCHOR_RAIL_H + tabH,
    waveH: WAVE_H,
    total: ANCHOR_RAIL_H + tabH + WAVE_H,
    stringCount: strings,
  };
}

/** y of one string line. `string` is alphaTab's 1 = lowest-pitched. */
function stringY(layout: AlignmentLayout, string: number): number {
  const fromTop = layout.stringCount - string; // string N (highest) on top
  return layout.tabTop + TAB_PAD + fromTop * STRING_GAP;
}

export interface ScoreMarker {
  label: string;
  scoreTimeSec: number;
  audioTimeSec: number;
  isDownbeat: boolean;
}

export interface AlignmentRenderOpts {
  width: number;
  pxPerSec: number;
  layout: AlignmentLayout;
  peaks: Peaks;
  syncMap: SyncMap | null;
  anchors: SyncAnchor[];
  notes: SynthNote[];
  /** Bar lines / beat grid, already mapped to audio time. */
  markers: ScoreMarker[];
  selectedScoreTime: number | null;
  suspectRegions: Array<{ scoreStart: number; scoreEnd: number }>;
  /** Measured onset residuals, one per downbeat marker. Optional overlay. */
  hits: OnsetHit[] | null;
  /** Score times of anchors the map could not honour (drawn amber). */
  unappliedAnchors: Set<number>;
  dragAnchorScoreTime: number | null;
  dragAudioTime: number | null;
}

const COL = {
  bg: "#101318",
  rail: "#171b22",
  tab: "#0c0f13",
  hairline: "rgba(255,255,255,0.07)",
  beat: "rgba(255,255,255,0.05)",
  bar: "rgba(255,255,255,0.16)",
  barLabel: "rgba(148,163,184,0.7)",
  stringLine: "rgba(148,163,184,0.28)",
  fret: "#e4e4e7",
  fretSelected: "#facc15",
  anchorUnapplied: "#f59e0b",
  wave: "#2dd4bf",
  waveFill: "rgba(45,212,191,0.45)",
  anchor: "#ef4444",
  label: "rgba(113,113,122,0.6)",
};

function residualColour(absMs: number): string {
  if (absMs < 40) return "#16181c";
  if (absMs < 100) return "#fbbf24";
  return "#f87171";
}

export function drawAlignmentStack(
  ctx: CanvasRenderingContext2D,
  opts: AlignmentRenderOpts,
): void {
  const {
    width,
    pxPerSec,
    layout,
    peaks,
    syncMap,
    anchors,
    notes,
    markers,
    selectedScoreTime,
    suspectRegions,
    hits,
    unappliedAnchors,
    dragAnchorScoreTime,
    dragAudioTime,
  } = opts;

  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, width, layout.total);
  ctx.fillStyle = COL.rail;
  ctx.fillRect(0, 0, width, layout.anchorH);
  ctx.fillStyle = COL.tab;
  ctx.fillRect(0, layout.tabTop, width, layout.tabH);

  hairline(ctx, width, layout.tabTop);
  hairline(ctx, width, layout.waveTop);

  // --- bar / beat grid through the tab + waveform ---------------------------
  for (const m of markers) {
    const x = Math.round(m.audioTimeSec * pxPerSec) + 0.5;
    if (x < -1 || x > width + 1) continue;
    ctx.strokeStyle = m.isDownbeat ? COL.bar : COL.beat;
    ctx.beginPath();
    ctx.moveTo(x, layout.tabTop);
    ctx.lineTo(x, layout.total);
    ctx.stroke();
  }

  // --- waveform -------------------------------------------------------------
  if (syncMap && suspectRegions.length) {
    ctx.fillStyle = "rgba(248,113,113,0.08)";
    for (const r of suspectRegions) {
      const x0 = syncMap.scoreTimeToAudioTime(r.scoreStart) * pxPerSec;
      const x1 = syncMap.scoreTimeToAudioTime(r.scoreEnd) * pxPerSec;
      ctx.fillRect(x0, layout.tabTop, x1 - x0, layout.total - layout.tabTop);
    }
  }
  drawWaveform(ctx, peaks, width, layout);

  // --- tab ------------------------------------------------------------------
  drawTab(ctx, { width, pxPerSec, layout, notes, syncMap, selectedScoreTime });

  // bar numbers sit above the top string line
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillStyle = COL.barLabel;
  let lastLabelX = -Infinity;
  for (const m of markers) {
    if (!m.isDownbeat || !m.label) continue;
    const x = m.audioTimeSec * pxPerSec;
    if (x < 0 || x > width || x - lastLabelX < 22) continue;
    lastLabelX = x;
    ctx.fillText(m.label, x + 3, layout.tabTop + 11);
  }

  // --- residual overlay (only after "Measure onsets") ------------------------
  if (hits) {
    const downbeats = markers.filter((m) => m.isDownbeat);
    hits.forEach((h, i) => {
      const m = downbeats[i];
      if (!m || !h.found) return;
      const c = residualColour(Math.abs(h.residualSec * 1000));
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.audioTimeSec * pxPerSec, layout.waveTop + 2);
      ctx.lineTo(h.onsetSec * pxPerSec, layout.waveTop + 12);
      ctx.stroke();
      ctx.lineWidth = 1;
    });
  }

  // --- anchor rail ----------------------------------------------------------
  drawAnchorRail(ctx, {
    width,
    pxPerSec,
    layout,
    anchors,
    unappliedAnchors,
    dragAnchorScoreTime,
    dragAudioTime,
  });

  // --- selection guide ------------------------------------------------------
  if (selectedScoreTime != null && syncMap) {
    const x = syncMap.scoreTimeToAudioTime(selectedScoreTime) * pxPerSec;
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, layout.total);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
}

function hairline(ctx: CanvasRenderingContext2D, width: number, y: number) {
  ctx.strokeStyle = COL.hairline;
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(width, y + 0.5);
  ctx.stroke();
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: Peaks,
  width: number,
  layout: AlignmentLayout,
): void {
  const base = layout.waveTop + layout.waveH;
  const h = layout.waveH - 6;

  // Filled envelope, baseline at the bottom — GoPlayAlong's shape, which reads
  // attacks more clearly than a centred min/max blob at these zoom levels.
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let b = 0; b < peaks.bucketCount; b++) {
    const x = (b / peaks.bucketCount) * width;
    const amp = Math.max(
      Math.abs(peaks.minMax[b * 2]),
      Math.abs(peaks.minMax[b * 2 + 1]),
    );
    ctx.lineTo(x, base - amp * h);
  }
  ctx.lineTo(width, base);
  ctx.closePath();
  ctx.fillStyle = COL.waveFill;
  ctx.fill();
  ctx.strokeStyle = COL.wave;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTab(
  ctx: CanvasRenderingContext2D,
  o: {
    width: number;
    pxPerSec: number;
    layout: AlignmentLayout;
    notes: SynthNote[];
    syncMap: SyncMap | null;
    selectedScoreTime: number | null;
  },
): void {
  const { width, pxPerSec, layout, notes, syncMap, selectedScoreTime } = o;

  ctx.strokeStyle = COL.stringLine;
  for (let s = 1; s <= layout.stringCount; s++) {
    const y = stringY(layout, s) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  if (!syncMap) return;

  ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Per-string last-drawn x, so a dense passage thins out instead of smearing.
  const lastX = new Map<number, number>();

  for (const n of notes) {
    const x = syncMap.scoreTimeToAudioTime(n.scoreTime) * pxPerSec;
    if (x < -12 || x > width + 12) continue;
    const string = n.string ?? 1;
    const y = stringY(layout, string);
    const selected =
      selectedScoreTime != null && Math.abs(n.scoreTime - selectedScoreTime) < 0.02;

    const label = n.fret != null ? String(n.fret) : "•";
    const prev = lastX.get(string);
    if (!selected && prev != null && x - prev < 11) continue;
    lastX.set(string, x);

    // knock the string line out behind the digit, like engraved tab
    const w = ctx.measureText(label).width + 4;
    ctx.fillStyle = selected ? "rgba(250,204,21,0.18)" : COL.tab;
    ctx.fillRect(x - w / 2, y - 6, w, 12);
    ctx.fillStyle = selected ? COL.fretSelected : COL.fret;
    ctx.fillText(label, x, y);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawAnchorRail(
  ctx: CanvasRenderingContext2D,
  o: {
    width: number;
    pxPerSec: number;
    layout: AlignmentLayout;
    anchors: SyncAnchor[];
    unappliedAnchors: Set<number>;
    dragAnchorScoreTime: number | null;
    dragAudioTime: number | null;
  },
): void {
  const {
    width,
    pxPerSec,
    layout,
    anchors,
    unappliedAnchors,
    dragAnchorScoreTime,
    dragAudioTime,
  } = o;

  ctx.font = "9px ui-monospace, monospace";
  ctx.fillStyle = COL.label;
  ctx.fillText("Sync points", 6, 12);

  ctx.strokeStyle = "rgba(148,163,184,0.2)";
  const tickStep = pxPerSec >= 120 ? 1 : pxPerSec >= 60 ? 2 : 5;
  for (let t = 0; t * pxPerSec <= width; t += tickStep) {
    const x = Math.round(t * pxPerSec) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, layout.anchorH - 7);
    ctx.lineTo(x, layout.anchorH);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  anchors.forEach((a, i) => {
    const dragging =
      dragAnchorScoreTime != null &&
      Math.abs(a.scoreTime - dragAnchorScoreTime) < 0.005;
    const audio = dragging && dragAudioTime != null ? dragAudioTime : a.audioTime;
    const x = audio * pxPerSec;
    const cy = layout.anchorH / 2 + 2;
    // Amber = the map could not pass through this anchor (it would make audio
    // time run backwards), so it is sitting here doing nothing.
    ctx.fillStyle = unappliedAnchors.has(a.scoreTime)
      ? COL.anchorUnapplied
      : COL.anchor;
    ctx.beginPath();
    ctx.arc(x, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px ui-sans-serif, system-ui";
    ctx.fillText(String(i + 1), x, cy + 0.5);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Which row of the canvas was hit. */
export type AlignmentRegion = "anchor" | "tab" | "wave";

export function hitAlignmentRegion(
  offsetY: number,
  layout: AlignmentLayout,
): AlignmentRegion {
  if (offsetY < layout.anchorH) return "anchor";
  if (offsetY < layout.waveTop) return "tab";
  return "wave";
}

/** Nearest anchor within `tolPx`, or null. */
export function hitAnchor(
  anchors: SyncAnchor[],
  audioTime: number,
  pxPerSec: number,
  tolPx = 12,
): SyncAnchor | null {
  let best: SyncAnchor | null = null;
  let bestD = tolPx;
  for (const a of anchors) {
    const d = Math.abs((a.audioTime - audioTime) * pxPerSec);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** Nearest score event (note or bar line) for selection, in score time. */
export function hitScoreEvent(
  notes: SynthNote[],
  markers: ScoreMarker[],
  syncMap: SyncMap,
  audioTime: number,
  pxPerSec: number,
  tolPx = 14,
): number | null {
  let bestScore: number | null = null;
  let bestD = tolPx / pxPerSec;

  for (const n of notes) {
    const d = Math.abs(syncMap.scoreTimeToAudioTime(n.scoreTime) - audioTime);
    if (d < bestD) {
      bestD = d;
      bestScore = n.scoreTime;
    }
  }
  for (const m of markers) {
    if (!m.isDownbeat) continue;
    const d = Math.abs(m.audioTimeSec - audioTime);
    if (d < bestD) {
      bestD = d;
      bestScore = m.scoreTimeSec;
    }
  }
  return bestScore;
}
