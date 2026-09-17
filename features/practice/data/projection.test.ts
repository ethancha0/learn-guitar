import { describe, expect, it } from "vitest";
import {
  CX,
  FAR,
  HIT_Y,
  HORIZON_Y,
  depthForOffset,
  isCulled,
  laneCenterX,
  perspective,
  projectLane,
  projectNote,
} from "./projection";

describe("perspective", () => {
  it("is 1 at the hit line (z = 0)", () => {
    expect(perspective(0)).toBe(1);
  });

  it("matches the documented FAR value at the horizon (z = 1)", () => {
    expect(perspective(1)).toBeCloseTo(1 / 5.5, 9);
    expect(FAR).toBeCloseTo(1 / 5.5, 9);
  });

  it("decreases monotonically as z grows", () => {
    expect(perspective(0.25)).toBeGreaterThan(perspective(0.5));
    expect(perspective(0.5)).toBeGreaterThan(perspective(0.75));
  });
});

describe("projectLane", () => {
  it("places every lane center on its own hit-line x at z = 0", () => {
    expect(projectLane(0, 0).x).toBeCloseTo(245, 9);
    expect(projectLane(1, 0).x).toBeCloseTo(495, 9);
    expect(projectLane(2, 0).x).toBeCloseTo(745, 9);
    expect(projectLane(3, 0).x).toBeCloseTo(995, 9);
  });

  it("puts every lane at the hit line's y at z = 0", () => {
    for (const lane of [0, 1, 2, 3]) {
      expect(projectLane(lane, 0).y).toBeCloseTo(HIT_Y, 9);
    }
  });

  it("puts every lane at the horizon's y at z = 1", () => {
    for (const lane of [0, 1, 2, 3]) {
      expect(projectLane(lane, 1).y).toBeCloseTo(HORIZON_Y, 9);
    }
  });

  it("converges lanes toward the center as depth increases", () => {
    const near = projectLane(0, 0.1).x;
    const far = projectLane(0, 0.9).x;
    expect(Math.abs(far - CX)).toBeLessThan(Math.abs(near - CX));
  });

  it("unknown lanes fall back to the vanishing point x", () => {
    expect(laneCenterX(99)).toBe(CX);
  });
});

describe("projectNote", () => {
  it("is full size at the hit line and shrinks toward the horizon", () => {
    const atHit = projectNote(0, 0);
    const atHorizon = projectNote(0, 1);
    expect(atHit.width).toBeCloseTo(150, 9);
    expect(atHit.height).toBeCloseTo(34, 9);
    expect(atHorizon.width).toBeLessThan(atHit.width);
    expect(atHorizon.height).toBeLessThan(atHit.height);
  });
});

describe("depthForOffset", () => {
  it("maps 0 offset to the hit line and the lookahead to the horizon", () => {
    expect(depthForOffset(0, 2)).toBe(0);
    expect(depthForOffset(2, 2)).toBe(1);
  });

  it("goes negative once the note has passed the hit line", () => {
    expect(depthForOffset(-0.5, 2)).toBeLessThan(0);
  });
});

describe("isCulled", () => {
  it("keeps notes within the visible band", () => {
    expect(isCulled(0)).toBe(false);
    expect(isCulled(0.5)).toBe(false);
    expect(isCulled(1)).toBe(false);
  });

  it("culls notes past the horizon or well behind the hit line", () => {
    expect(isCulled(1.01)).toBe(true);
    expect(isCulled(-0.2)).toBe(true);
  });
});
