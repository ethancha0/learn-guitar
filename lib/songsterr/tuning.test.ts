import { describe, expect, it } from "vitest";
import { midiNoteName, tuningLabel } from "./tuning";

describe("midiNoteName", () => {
  it("anchors on middle C", () => {
    expect(midiNoteName(60)).toBe("C4");
  });

  it("names bass standard strings", () => {
    expect([43, 38, 33, 28].map(midiNoteName)).toEqual(["G2", "D2", "A1", "E1"]);
  });
});

describe("tuningLabel", () => {
  it("renders bass standard high string first", () => {
    expect(tuningLabel([43, 38, 33, 28])).toBe("G2 D2 A1 E1");
  });

  it("renders drop D", () => {
    expect(tuningLabel([43, 38, 33, 26])).toBe("G2 D2 A1 D1");
  });

  it("renders a whole-step-down bass", () => {
    expect(tuningLabel([41, 36, 31, 26])).toBe("F2 C2 G1 D1");
  });

  it("returns undefined for a drum track with no tuning", () => {
    expect(tuningLabel(undefined)).toBeUndefined();
    expect(tuningLabel([])).toBeUndefined();
  });
});
