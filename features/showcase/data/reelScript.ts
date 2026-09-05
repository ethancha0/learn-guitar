/**
 * The running order for the showcase reel.
 *
 * The reel is a fixed-length montage rather than an interactive demo: three
 * steps, one loop, no controls. Every duration lives here as data so the brief
 * — a five-to-eight second clip — can be asserted in a test instead of being
 * spread across a pile of `delay` props in the JSX.
 */

export type ReelStepId = "import" | "play" | "mix";

/**
 * The mock screen a step is set on. Consecutive steps naming the same stage
 * keep it mounted, so the playhead sweeps straight through the cut from `play`
 * into `mix` rather than restarting on it.
 */
export type ReelStage = "library" | "player";

export interface ReelStep {
  id: ReelStepId;
  stage: ReelStage;
  /** Uppercase micro-label in the stage's header rule. */
  label: string;
  /** The line under the stage, in the editorial voice of the page headers. */
  caption: string;
  durationMs: number;
}

export const REEL_STEPS: readonly ReelStep[] = [
  {
    id: "import",
    stage: "library",
    label: "Import",
    caption: "Search once — the tab and the recording arrive together.",
    durationMs: 2600,
  },
  {
    id: "play",
    stage: "player",
    label: "Play",
    caption: "The playhead rides the record, bar by bar.",
    durationMs: 2600,
  },
  {
    id: "mix",
    stage: "player",
    label: "Practise",
    caption: "Take it slower, and balance the band against your part.",
    durationMs: 2400,
  },
];

export const REEL_DURATION_MS = REEL_STEPS.reduce(
  (total, step) => total + step.durationMs,
  0,
);

export function stepDurationMs(id: ReelStepId): number {
  const step = REEL_STEPS.find((candidate) => candidate.id === id);
  return step ? step.durationMs : 0;
}

/** Milliseconds from the top of the loop to the start of `index`. */
export function stepStartMs(index: number): number {
  return REEL_STEPS.slice(0, index).reduce(
    (total, step) => total + step.durationMs,
    0,
  );
}

/**
 * How long a stage holds the frame across the consecutive steps that share it.
 * The player's sweep is timed against this, not against a single step.
 */
export function stageDurationMs(stage: ReelStage): number {
  return REEL_STEPS.filter((step) => step.stage === stage).reduce(
    (total, step) => total + step.durationMs,
    0,
  );
}

/* --------------------------------------------------------------- sweep --- */

/** Where the playhead enters and leaves the staff, in percent of its width. */
export const SWEEP_START_PCT = 4;
export const SWEEP_END_PCT = 96;

/** The rate the `mix` step drops playback to. The sweep slows to match. */
export const REEL_SLOW_SPEED = 0.75;

const PLAY_MS = stepDurationMs("play");
const MIX_MS = stepDurationMs("mix");

/** The player stage runs the length of both of its steps. */
export const SWEEP_DURATION_MS = PLAY_MS + MIX_MS;

/**
 * Percent of the staff crossed per millisecond at full speed. Solved rather
 * than picked: the two legs together have to cover the whole staff, and the
 * second leg runs at `REEL_SLOW_SPEED` of the first.
 */
const FULL_RATE_PCT_PER_MS =
  (SWEEP_END_PCT - SWEEP_START_PCT) / (PLAY_MS + REEL_SLOW_SPEED * MIX_MS);

/** How far along the playhead is when the mixer opens and the speed drops. */
export const SWEEP_SLOWS_AT_PCT =
  SWEEP_START_PCT + FULL_RATE_PCT_PER_MS * PLAY_MS;

/**
 * When the playhead reaches `xPct`, in milliseconds from the moment the player
 * stage appears. Notes light as it crosses them and the bar wash steps with
 * it, so both are scheduled off this instead of being eyeballed.
 */
export function sweepTimeMs(xPct: number): number {
  const x = Math.min(Math.max(xPct, SWEEP_START_PCT), SWEEP_END_PCT);
  if (x <= SWEEP_SLOWS_AT_PCT) {
    return (x - SWEEP_START_PCT) / FULL_RATE_PCT_PER_MS;
  }
  return (
    PLAY_MS + (x - SWEEP_SLOWS_AT_PCT) / (FULL_RATE_PCT_PER_MS * REEL_SLOW_SPEED)
  );
}
