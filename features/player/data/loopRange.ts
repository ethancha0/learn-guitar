"use client";

/**
 * Bar ↔ MIDI-tick translation for the loop-section feature.
 *
 * alphaTab addresses `api.playbackRange` in MIDI ticks, but a practice loop is
 * something the user picks in *bars* ("loop bars 3–6"). These helpers convert
 * between the two against alphaTab's `MidiTickLookup.masterBars`, which is the
 * only place that knows where a bar actually starts once repeats and tempo
 * changes are expanded.
 *
 * Deliberately pure and alphaTab-free apart from `barTickRangesFromLookup`, so
 * the arithmetic is testable without loading a score.
 */

export interface BarTickRange {
  /** 1-based bar number as printed on the score. */
  barNumber: number;
  startTick: number;
  /** Exclusive: the tick at which the next bar begins. */
  endTick: number;
}

export interface BarRange {
  startBar: number;
  endBar: number;
}

/**
 * Collapse alphaTab's playback-order bar lookup into one entry per *printed*
 * bar. A repeated bar appears several times in playback order; the loop UI
 * talks about the bar itself, so the first pass is what we address (the same
 * convention alphaTab's own `getMasterBarStart` uses).
 */
export function barTickRangesFromLookup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  masterBars: any[] | undefined | null,
): BarTickRange[] {
  if (!masterBars?.length) return [];
  const byBar = new Map<number, BarTickRange>();
  for (const b of masterBars) {
    const index: number | undefined = b?.masterBar?.index;
    if (typeof index !== "number") continue;
    if (byBar.has(index)) continue;
    byBar.set(index, {
      barNumber: index + 1,
      startTick: b.start,
      endTick: b.end,
    });
  }
  return [...byBar.values()].sort((a, b) => a.barNumber - b.barNumber);
}

/** The bar containing `tick`, or null when the score has no bars. */
export function barAtTick(
  ranges: readonly BarTickRange[],
  tick: number,
): number | null {
  if (ranges.length === 0) return null;
  for (const r of ranges) {
    if (tick < r.endTick) return r.barNumber;
  }
  return ranges[ranges.length - 1].barNumber;
}

/** Keep a bar range inside the score, ordered, and at least one bar long. */
export function clampBarRange(
  ranges: readonly BarTickRange[],
  range: BarRange,
): BarRange | null {
  if (ranges.length === 0) return null;
  const first = ranges[0].barNumber;
  const last = ranges[ranges.length - 1].barNumber;
  const clamp = (n: number) => Math.min(last, Math.max(first, Math.round(n)));
  let startBar = clamp(range.startBar);
  let endBar = clamp(range.endBar);
  if (endBar < startBar) [startBar, endBar] = [endBar, startBar];
  return { startBar, endBar };
}

/**
 * Ticks for a bar range, ready for `api.playbackRange`.
 *
 * `endTick` is the *end* of the last bar: alphaTab finishes (or wraps a loop)
 * on `tickPosition >= endTick`, so this plays the closing bar in full.
 */
export function barRangeToTicks(
  ranges: readonly BarTickRange[],
  range: BarRange,
): { startTick: number; endTick: number } | null {
  const clamped = clampBarRange(ranges, range);
  if (!clamped) return null;
  const start = ranges.find((r) => r.barNumber === clamped.startBar);
  const end = ranges.find((r) => r.barNumber === clamped.endBar);
  if (!start || !end) return null;
  return { startTick: start.startTick, endTick: Math.max(end.endTick, start.startTick + 1) };
}

/**
 * The bar range an existing tick range covers. alphaTab's own drag-selection
 * ends the range a few ticks *inside* the final bar (it subtracts 50 so the
 * cursor doesn't spill into the next one), so the end tick is resolved by the
 * bar it falls in rather than by an exact boundary match.
 */
export function ticksToBarRange(
  ranges: readonly BarTickRange[],
  ticks: { startTick: number; endTick: number } | null | undefined,
): BarRange | null {
  if (!ticks || ranges.length === 0) return null;
  const startBar = barAtTick(ranges, ticks.startTick);
  // A range ending exactly on a boundary belongs to the bar before it.
  const endBar = barAtTick(ranges, Math.max(ticks.startTick, ticks.endTick - 1));
  if (startBar === null || endBar === null) return null;
  return clampBarRange(ranges, { startBar, endBar });
}
