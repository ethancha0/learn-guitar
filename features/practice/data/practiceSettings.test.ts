import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRACTICE_SETTINGS,
  keyLabel,
  laneForKey,
  normalizeBindingKey,
  sanitizePracticeSettings,
} from "./practiceSettings";

describe("sanitizePracticeSettings", () => {
  it("fills altKeys for settings saved before they existed", () => {
    const s = sanitizePracticeSettings({ keys: ["a", "s", "d", "f"] });
    expect(s.keys).toEqual(["a", "s", "d", "f"]);
    expect(s.altKeys).toEqual(["", "", "", ""]);
  });

  it("falls back per-slot for an empty primary key", () => {
    const s = sanitizePracticeSettings({ keys: ["a", "", "d", "f"] });
    expect(s.keys).toEqual(["a", "k", "d", "f"]);
  });
});

describe("laneForKey", () => {
  const settings = {
    ...DEFAULT_PRACTICE_SETTINGS,
    altKeys: ["f", "", " ", "ArrowUp"] as const as [string, string, string, string],
  };

  it("matches primary keys case-insensitively", () => {
    expect(laneForKey(settings, "J")).toBe(0);
    expect(laneForKey(settings, ";")).toBe(3);
  });

  it("matches alternate keys, including named ones", () => {
    expect(laneForKey(settings, "f")).toBe(0);
    expect(laneForKey(settings, " ")).toBe(2);
    expect(laneForKey(settings, "ArrowUp")).toBe(3);
    expect(laneForKey(settings, "q")).toBe(-1);
  });

  it("never matches an unset alternate", () => {
    expect(laneForKey(settings, "")).toBe(-1);
  });
});

describe("normalizeBindingKey / keyLabel", () => {
  it("rejects modifiers and lowercases letters", () => {
    expect(normalizeBindingKey("Shift")).toBeNull();
    expect(normalizeBindingKey("Escape")).toBeNull();
    expect(normalizeBindingKey("K")).toBe("k");
    expect(normalizeBindingKey("ArrowLeft")).toBe("ArrowLeft");
  });

  it("labels keys for keycaps", () => {
    expect(keyLabel("j")).toBe("J");
    expect(keyLabel(" ")).toBe("SPACE");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("")).toBe("");
  });
});
