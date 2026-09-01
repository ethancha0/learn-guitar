import * as alphaTab from "@coderline/alphatab";

export interface DurationMapping {
  duration: alphaTab.model.Duration;
  dots: number;
  /** True when no note value matched exactly and the closest one was used. */
  isApproximate: boolean;
}

const BASE_DURATIONS: alphaTab.model.Duration[] = [
  alphaTab.model.Duration.Whole,
  alphaTab.model.Duration.Half,
  alphaTab.model.Duration.Quarter,
  alphaTab.model.Duration.Eighth,
  alphaTab.model.Duration.Sixteenth,
  alphaTab.model.Duration.ThirtySecond,
  alphaTab.model.Duration.SixtyFourth,
];

const FALLBACK: DurationMapping = {
  duration: alphaTab.model.Duration.Quarter,
  dots: 0,
  isApproximate: true,
};

/**
 * Songsterr writes a beat's length as a `[numerator, denominator]` fraction of
 * a whole note, which is more expressive than Guitar Pro's note values. Pick
 * the closest note value + dots, since there is no exact equivalent for things
 * like a beat that fills an odd slice of a bar.
 */
export function mapSongsterrDuration(
  duration: [number, number] | undefined,
): DurationMapping {
  if (!duration) return FALLBACK;

  const [numerator, denominator] = duration;
  if (!numerator || !denominator) return FALLBACK;

  const target = numerator / denominator;
  let bestDuration = alphaTab.model.Duration.Quarter;
  let bestDots = 0;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const candidate of BASE_DURATIONS) {
    const baseValue = 1 / Number(candidate);
    for (const dots of [0, 1, 2]) {
      // Each dot adds half of what the previous one added.
      const dottedValue =
        baseValue + (dots >= 1 ? baseValue / 2 : 0) + (dots >= 2 ? baseValue / 4 : 0);
      const delta = Math.abs(dottedValue - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestDuration = candidate;
        bestDots = dots;
      }
    }
  }

  return {
    duration: bestDuration,
    dots: bestDots,
    isApproximate: bestDelta > 0.000001,
  };
}
