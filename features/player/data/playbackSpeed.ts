/**
 * Playback-rate maths shared by the transport bar and the mixer sheet. The
 * slider works in percent (100% = normal speed) while alphaTab and the audio
 * element want a multiplier.
 */

export const SPEED_MULT_MIN = 0.25;
export const SPEED_MULT_MAX = 2;
export const SPEED_PERCENT_MIN = 0;
export const SPEED_SLIDER_MAX = 100;
export const SPEED_KEYBOARD_PERCENT_MAX = 200;
export const SPEED_PERCENT_STEP = 5;

export function snapSpeedPercent(
  percent: number,
  max = SPEED_SLIDER_MAX,
): number {
  return (
    Math.round(
      Math.max(SPEED_PERCENT_MIN, Math.min(max, percent)) / SPEED_PERCENT_STEP,
    ) * SPEED_PERCENT_STEP
  );
}

export function clampSpeed(value: number): number {
  return (
    Math.round(Math.max(SPEED_MULT_MIN, Math.min(SPEED_MULT_MAX, value)) * 100) /
    100
  );
}

/** Slider percent (0–100) → playback multiplier; 100% = normal speed. */
export function percentToSpeed(percent: number): number {
  const p = snapSpeedPercent(percent);
  if (p === 0) return SPEED_MULT_MIN;
  return clampSpeed(p / 100);
}

/** Playback multiplier → percent label (up to 200% / 2x). */
export function speedToPercent(speed: number): number {
  return snapSpeedPercent(speed * 100, SPEED_KEYBOARD_PERCENT_MAX);
}

/** Slider position; pins at 100% once speed exceeds 1x. */
export function speedToSliderPercent(speed: number): number {
  return snapSpeedPercent(
    Math.min(SPEED_SLIDER_MAX, speed * 100),
    SPEED_SLIDER_MAX,
  );
}
