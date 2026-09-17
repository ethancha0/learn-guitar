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

/** General MIDI program numbers for the acoustic/electric bass family. */
const GM_BASS_PROGRAM_MIN = 32;
const GM_BASS_PROGRAM_MAX = 39;

/**
 * Finds the track rhythm practice should play, independent of whichever
 * track the score player happens to be showing — a song's default/preferred
 * track is very often a guitar or vocal part, and blindly practicing that one
 * against a 4-string highway always rejected it as "too many strings" even
 * when a perfectly good bass track sat right next to it in the same file.
 *
 * Scores every track that's strung for 4 or fewer strings (so anything wider
 * — 5/6-string bass, 6-string guitar — is excluded outright) by how well it
 * reads as *the* bass part: a General MIDI bass program, "bass" in its name,
 * and an exact 4-string count are each worth points. Returns null when no
 * track qualifies at all.
 */
export async function pickBassTrackIndex(gpBytes: Uint8Array): Promise<number | null> {
  const alphaTab = await import("@coderline/alphatab");
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(gpBytes, settings);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracks: any[] = score.tracks ?? [];

  let bestIndex: number | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stringCount: number = (track.staves ?? []).reduce(
      (n: number, st: { tuning?: unknown[] }) => Math.max(n, st.tuning?.length ?? 0),
      0,
    );
    if (stringCount === 0 || stringCount > 4) continue;

    const name = `${track.name ?? ""} ${track.shortName ?? ""}`.toLowerCase();
    const program: number = track.playbackInfo?.program ?? -1;
    const isBassProgram = program >= GM_BASS_PROGRAM_MIN && program <= GM_BASS_PROGRAM_MAX;
    const isBassName = name.includes("bass");

    let candidateScore = stringCount === 4 ? 1 : 0;
    if (isBassProgram) candidateScore += 3;
    if (isBassName) candidateScore += 2;

    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestIndex = i;
    }
  }
  return bestIndex;
}

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
    midi: n.midi,
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
