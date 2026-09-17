/**
 * Hit windows, verdicts and scoring for the rhythm mode. Pure and
 * unit-tested — see the handoff doc's "Hit detection" / "Scoring" / "Miss"
 * sections for the numbers reproduced here.
 */

import type { NoteJudgement } from "../types/practice";

export const DEFAULT_HIT_WINDOW_SEC = 0.2;
export const PERFECT_WINDOW_SEC = 0.065;
export const GOOD_WINDOW_SEC = 0.13;

export const JUDGEMENT_POINTS: Record<Exclude<NoteJudgement, "miss">, number> = {
  perfect: 100,
  good: 65,
  early: 35,
  late: 35,
};

export const COMBO_MULTIPLIER_CAP = 60;
export const MISS_CONDITION_PENALTY = 7;
export const HIT_CONDITION_RESTORE = 2;
export const MAX_CONDITION = 100;

/** Verdict for a hit whose timing offset (struck − expected, seconds) is known. */
export function judgeOffset(offsetSec: number): Exclude<NoteJudgement, "miss"> {
  const abs = Math.abs(offsetSec);
  if (abs < PERFECT_WINDOW_SEC) return "perfect";
  if (abs < GOOD_WINDOW_SEC) return "good";
  return offsetSec < 0 ? "early" : "late";
}

/** Points for a verdict at the given (pre-hit) combo count. */
export function scoreForJudgement(
  judgement: Exclude<NoteJudgement, "miss">,
  combo: number,
): number {
  const multiplier = 1 + Math.min(combo, COMBO_MULTIPLIER_CAP) / COMBO_MULTIPLIER_CAP;
  return Math.round(JUDGEMENT_POINTS[judgement] * multiplier);
}

export function applyHitCondition(condition: number): number {
  return Math.min(MAX_CONDITION, condition + HIT_CONDITION_RESTORE);
}

export function applyMissCondition(condition: number): number {
  return Math.max(0, condition - MISS_CONDITION_PENALTY);
}

export interface JudgeableNote {
  t: number;
  lane: number;
  state: NoteJudgement | null;
}

/**
 * Nearest unjudged note in `lane` within `hitWindowSec` of `t`, or null for a
 * whiff. Notes are usually near-sorted by time, but this doesn't assume it.
 */
export function findNearestNote<T extends JudgeableNote>(
  notes: readonly T[],
  lane: number,
  t: number,
  hitWindowSec = DEFAULT_HIT_WINDOW_SEC,
): T | null {
  let best: T | null = null;
  let bestDist = hitWindowSec;
  for (const note of notes) {
    if (note.lane !== lane || note.state !== null) continue;
    const dist = Math.abs(note.t - t);
    if (dist <= bestDist) {
      bestDist = dist;
      best = note;
    }
  }
  return best;
}
