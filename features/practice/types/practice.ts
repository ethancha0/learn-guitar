/**
 * Rhythm-practice types. A chart is a flat list of notes on the score
 * timeline (seconds), one per string per beat — see `data/buildChart.ts` for
 * how it is derived from the real score.
 */

export type Lane = 0 | 1 | 2 | 3;

export type NoteJudgement = "perfect" | "good" | "early" | "late" | "miss";

export interface PracticeNote {
  id: string;
  /** Score time (seconds) the note should be struck. */
  t: number;
  lane: Lane;
  fret: number;
  /** MIDI pitch, straight from the score — drives the strike synth. */
  midi: number;
  /** 1-based bar number, for the per-bar accuracy chart. */
  bar: number;
  state: NoteJudgement | null;
}

export interface PracticeChart {
  notes: PracticeNote[];
  bars: number;
  bpm: number;
  metre: string;
  durationSec: number;
  /** Every beat across the song, seconds — feeds the highway's beat lines. */
  beatSec: number[];
  /** Score time each bar starts at (first pass only), 1 per bar. */
  barStartSec: number[];
}

export interface JudgementPop {
  id: string;
  lane: Lane;
  text: string;
  judgement: NoteJudgement;
  at: number;
}

export interface JudgeFlash {
  text: string;
  judgement: NoteJudgement;
  at: number;
}

export type RunPhase = "idle" | "running" | "paused" | "completed" | "failed";

export type JudgeCounts = Record<NoteJudgement, number>;

export const EMPTY_JUDGE_COUNTS: JudgeCounts = {
  perfect: 0,
  good: 0,
  early: 0,
  late: 0,
  miss: 0,
};
