import { describe, expect, it } from "vitest";
import {
  applyHitCondition,
  applyMissCondition,
  findNearestNote,
  judgeOffset,
  scoreForJudgement,
} from "./judge";

describe("judgeOffset", () => {
  it("is perfect inside 55ms", () => {
    expect(judgeOffset(0)).toBe("perfect");
    expect(judgeOffset(0.03)).toBe("perfect");
    expect(judgeOffset(-0.05)).toBe("perfect");
  });

  it("is good between 55ms and 110ms", () => {
    expect(judgeOffset(0.08)).toBe("good");
    expect(judgeOffset(-0.09)).toBe("good");
  });

  it("is early/late beyond 110ms, by sign", () => {
    expect(judgeOffset(-0.15)).toBe("early");
    expect(judgeOffset(0.15)).toBe("late");
  });
});

describe("scoreForJudgement", () => {
  it("awards base points at zero combo", () => {
    expect(scoreForJudgement("perfect", 0)).toBe(100);
    expect(scoreForJudgement("good", 0)).toBe(65);
    expect(scoreForJudgement("early", 0)).toBe(35);
  });

  it("scales up to 2x at the combo cap", () => {
    expect(scoreForJudgement("perfect", 60)).toBe(200);
    expect(scoreForJudgement("perfect", 120)).toBe(200); // capped
  });

  it("scales linearly under the cap", () => {
    expect(scoreForJudgement("perfect", 30)).toBe(150);
  });
});

describe("condition", () => {
  it("misses cost 7, floored at 0", () => {
    expect(applyMissCondition(10)).toBe(3);
    expect(applyMissCondition(3)).toBe(0);
  });

  it("hits restore 2, capped at 100", () => {
    expect(applyHitCondition(50)).toBe(52);
    expect(applyHitCondition(99)).toBe(100);
  });
});

describe("findNearestNote", () => {
  const notes = [
    { t: 1, lane: 0, state: null },
    { t: 1.05, lane: 0, state: null },
    { t: 2, lane: 1, state: null },
    { t: 3, lane: 0, state: "perfect" as const },
  ];

  it("finds the closest unjudged note in the lane within the window", () => {
    const hit = findNearestNote(notes, 0, 1.02);
    expect(hit?.t).toBe(1);
  });

  it("ignores other lanes", () => {
    expect(findNearestNote(notes, 1, 1)).toBeNull();
  });

  it("ignores already-judged notes", () => {
    expect(findNearestNote(notes, 0, 3, 0.5)).toBeNull();
  });

  it("returns null when nothing is within the hit window", () => {
    expect(findNearestNote(notes, 0, 1.5, 0.17)).toBeNull();
  });
});
