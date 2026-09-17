"use client";

/**
 * Builds a rhythm-game chart from the real score, not a hand-written riff.
 *
 * `extractTrackTab` already walks the track with alphaTab's MIDI generator to
 * get per-note score time / duration / string / fret — the exact pipeline
 * `TrackSynth` uses for the reference tone — so chart timing matches playback
 * exactly. `extractScoreTimeline` supplies the bar grid (for the per-bar
 * accuracy chart) and the beat grid (for the highway's beat lines).
 */

import {
  extractTrackTab,
  type SynthNote,
} from "@/features/player/data/trackSynth";
import { extractScoreTimeline } from "@/features/player/data/scoreTimeline";
import type { Lane, PracticeChart, PracticeNote } from "../types/practice";

export class UnsupportedTrackError extends Error {}

/** A note this short (seconds) is a plain hit, not a hold. */
const MIN_HOLD_SEC = 0.28;

export async function buildChart(
  gpBytes: Uint8Array,
  trackIndex: number,
): Promise<PracticeChart> {
  const [{ notes, stringCount }, timeline] = await Promise.all([
    extractTrackTab(gpBytes, trackIndex),
    extractScoreTimeline(gpBytes),
  ]);

  if (stringCount > 4) {
    throw new UnsupportedTrackError(
      "Rhythm practice needs a 4-string bass track — this track has more strings.",
    );
  }

  const barStartSec = timeline.bars
    .filter((b) => b.occurence === 0)
    .map((b) => b.scoreTimeSec)
    .sort((a, b) => a - b);

  const barAt = (t: number): number => {
    if (barStartSec.length === 0) return 1;
    let lo = 0;
    let hi = barStartSec.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (barStartSec[mid] <= t + 1e-6) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const playable: SynthNote[] = notes.filter(
    (n): n is SynthNote & { string: number; fret: number } =>
      n.string != null && n.fret != null && n.string >= 1 && n.string <= 4,
  );

  const chartNotes: PracticeNote[] = playable.map((n, i) => ({
    id: `n${i}`,
    t: n.scoreTime,
    lane: (n.string! - 1) as Lane,
    fret: n.fret!,
    hold: n.scoreDuration >= MIN_HOLD_SEC ? n.scoreDuration : 0,
    bar: barAt(n.scoreTime),
    state: null,
  }));

  const firstBar = timeline.bars[0];

  return {
    notes: chartNotes,
    bars: barStartSec.length || 1,
    bpm: Math.round(timeline.tempo),
    metre: firstBar ? `${firstBar.beats}/4` : "4/4",
    durationSec: timeline.endSec,
    beatSec: timeline.beatSec,
    barStartSec,
  };
}
