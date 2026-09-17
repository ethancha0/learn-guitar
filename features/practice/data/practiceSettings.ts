"use client";

/**
 * Practice-mode preferences (key map, note speed, hit window, fret numbers)
 * and per-song bests, mirroring the persistence pattern in
 * `features/library/data/songStore.ts` — global settings under one
 * `learn-bass.*` key, per-song data keyed by song id inside it.
 */

export interface PracticeSettings {
  /** J K L ; by default, lanes E A D G. */
  keys: [string, string, string, string];
  /** Seconds of lookahead a note travels from the horizon to the hit line. */
  noteSpeedSec: number;
  hitWindowSec: number;
  showFretNumbers: boolean;
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  keys: ["j", "k", "l", ";"],
  noteSpeedSec: 1.6,
  hitWindowSec: 0.17,
  showFretNumbers: true,
};

const SETTINGS_KEY = "learn-bass.practice-settings";

export function getPracticeSettings(): PracticeSettings {
  if (typeof window === "undefined") return DEFAULT_PRACTICE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_PRACTICE_SETTINGS;
    const parsed = JSON.parse(raw);
    return sanitizePracticeSettings(parsed);
  } catch {
    return DEFAULT_PRACTICE_SETTINGS;
  }
}

export function sanitizePracticeSettings(
  value: Partial<PracticeSettings> | null | undefined,
): PracticeSettings {
  const keys = Array.isArray(value?.keys) && value.keys.length === 4
    ? (value.keys.map((k) => (typeof k === "string" && k ? k : "")) as [
        string,
        string,
        string,
        string,
      ])
    : DEFAULT_PRACTICE_SETTINGS.keys;
  const noteSpeedSec =
    typeof value?.noteSpeedSec === "number" && Number.isFinite(value.noteSpeedSec)
      ? Math.min(3, Math.max(0.6, value.noteSpeedSec))
      : DEFAULT_PRACTICE_SETTINGS.noteSpeedSec;
  const hitWindowSec =
    typeof value?.hitWindowSec === "number" && Number.isFinite(value.hitWindowSec)
      ? Math.min(0.3, Math.max(0.08, value.hitWindowSec))
      : DEFAULT_PRACTICE_SETTINGS.hitWindowSec;
  const showFretNumbers =
    typeof value?.showFretNumbers === "boolean"
      ? value.showFretNumbers
      : DEFAULT_PRACTICE_SETTINGS.showFretNumbers;
  return { keys, noteSpeedSec, hitWindowSec, showFretNumbers };
}

export function setPracticeSettings(next: PracticeSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

// --- per-song bests --------------------------------------------------------

export interface PracticeBest {
  accuracy: number;
  score: number;
  bestCombo: number;
  updatedAt: number;
}

const BEST_KEY = "learn-bass.practice-bests";

function readBests(): Record<string, PracticeBest> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getPracticeBest(songId: string): PracticeBest | undefined {
  return readBests()[songId];
}

/** Records a run, keeping it only if it beats the previous best score. */
export function recordPracticeRun(
  songId: string,
  run: Omit<PracticeBest, "updatedAt">,
): boolean {
  if (typeof window === "undefined") return false;
  const bests = readBests();
  const prev = bests[songId];
  const isBest = !prev || run.score > prev.score;
  if (isBest) {
    bests[songId] = { ...run, updatedAt: Date.now() };
    window.localStorage.setItem(BEST_KEY, JSON.stringify(bests));
  }
  return isBest;
}
