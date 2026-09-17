/**
 * The highway's perspective projection: a 1240×520 coordinate space where
 * `z = 0` is the hit line and `z = 1` is the horizon. Pure and unit-tested —
 * the visual illusion depends on these constants exactly, so nothing here
 * should be "close enough".
 */

export const HIGHWAY_WIDTH = 1240;
export const HIGHWAY_HEIGHT = 520;

export const HIT_Y = 470;
export const HORIZON_Y = 30;
export const CX = 620;

export const LANE_COUNT = 4;
/** Lane centers at the hit line, lane 0 (E) to lane 3 (G). */
export const LANE_CENTERS_AT_HIT: readonly number[] = [245, 495, 745, 995];
/** The 5 lane-boundary lines at the hit line. */
export const LANE_BOUNDARIES_AT_HIT: readonly number[] = [120, 370, 620, 870, 1120];

export const NOTE_WIDTH_AT_HIT = 150;
export const NOTE_HEIGHT_AT_HIT = 34;

const PERSPECTIVE_K = 4.5;

/** `f(z) = 1 / (1 + z * 4.5)`. */
export function perspective(z: number): number {
  return 1 / (1 + z * PERSPECTIVE_K);
}

export const FAR = perspective(1);

export function laneCenterX(lane: number): number {
  return LANE_CENTERS_AT_HIT[lane] ?? CX;
}

export function screenX(laneX: number, f: number): number {
  return CX + (laneX - CX) * f;
}

export function screenY(f: number): number {
  return HIT_Y - ((HIT_Y - HORIZON_Y) * (1 - f)) / (1 - FAR);
}

export interface ProjectedPoint {
  x: number;
  y: number;
  f: number;
}

/** Project a lane position at depth `z` (0 = hit line, 1 = horizon). */
export function projectLane(lane: number, z: number): ProjectedPoint {
  const f = perspective(z);
  return { x: screenX(laneCenterX(lane), f), y: screenY(f), f };
}

export interface ProjectedNote extends ProjectedPoint {
  width: number;
  height: number;
}

export function projectNote(lane: number, z: number): ProjectedNote {
  const p = projectLane(lane, z);
  return { ...p, width: NOTE_WIDTH_AT_HIT * p.f, height: NOTE_HEIGHT_AT_HIT * p.f };
}

/**
 * Depth for a note whose onset is `offsetSec` ahead of the playhead (negative
 * once it's passed the hit line), given a `lookaheadSec` window mapped to the
 * full `z ∈ [0, 1]` span.
 */
export function depthForOffset(offsetSec: number, lookaheadSec: number): number {
  if (lookaheadSec <= 0) return offsetSec > 0 ? Infinity : -Infinity;
  return offsetSec / lookaheadSec;
}

/** A note this far past the hit line, or beyond the horizon, is off-screen. */
export const CULL_Z_MIN = -0.12;
export const CULL_Z_MAX = 1;

export function isCulled(z: number): boolean {
  return z > CULL_Z_MAX || z < CULL_Z_MIN;
}
