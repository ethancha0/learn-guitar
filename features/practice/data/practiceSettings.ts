"use client";

/**
 * Practice-mode preferences (key map, note speed, hit window, fret numbers)
 * and per-song bests, mirroring the persistence pattern in
 * `features/library/data/songStore.ts` — global settings under one
 * `learn-bass.*` key, per-song data keyed by song id inside it.
 */

import { DEFAULT_HIT_WINDOW_SEC } from "./judge";

export type LaneKeys = [string, string, string, string];

export interface PracticeSettings {
  /** J K L ; by default, lanes E A D G. Values are `KeyboardEvent.key`. */
  keys: LaneKeys;
  /** Optional second key per lane; "" means unset. */
  altKeys: LaneKeys;
  /** Seconds of lookahead a note travels from the horizon to the hit line. */
  noteSpeedSec: number;
  hitWindowSec: number;
  showFretNumbers: boolean;
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  keys: ["j", "k", "l", ";"],
  altKeys: ["", "", "", ""],
  noteSpeedSec: 1.6,
  hitWindowSec: DEFAULT_HIT_WINDOW_SEC,
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
  const keys = sanitizeLaneKeys(value?.keys, DEFAULT_PRACTICE_SETTINGS.keys);
  const altKeys = sanitizeLaneKeys(value?.altKeys, DEFAULT_PRACTICE_SETTINGS.altKeys);
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
  return { keys, altKeys, noteSpeedSec, hitWindowSec, showFretNumbers };
}

function sanitizeLaneKeys(value: unknown, fallback: LaneKeys): LaneKeys {
  if (!Array.isArray(value) || value.length !== 4) return fallback;
  return value.map((k, i) =>
    typeof k === "string" && k ? k : fallback[i],
  ) as LaneKeys;
}

/** Keys that can never be bound to a lane. */
const UNBINDABLE_KEYS = new Set([
  "Shift", "Control", "Alt", "Meta", "CapsLock", "Escape", "Tab", "Enter",
]);

/** Normalises `KeyboardEvent.key` into the stored form, or null if unbindable. */
export function normalizeBindingKey(key: string): string | null {
  if (UNBINDABLE_KEYS.has(key) || key === "Dead" || key === "Unidentified") return null;
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Short label for a bound key ("j" → "J", " " → "SPACE", "ArrowUp" → "↑"). */
export function keyLabel(key: string): string {
  if (!key) return "";
  if (key === " ") return "SPACE";
  const arrows: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  };
  return arrows[key] ?? key.toUpperCase();
}

/** Lane index a key is bound to (primary or alternate), or -1. */
export function laneForKey(settings: PracticeSettings, key: string): number {
  if (!key) return -1;
  const k = key.length === 1 ? key.toLowerCase() : key;
  const primary = settings.keys.indexOf(k);
  if (primary !== -1) return primary;
  return settings.altKeys.indexOf(k);
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
