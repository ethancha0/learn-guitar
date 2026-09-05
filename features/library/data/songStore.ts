"use client";

import { useSyncExternalStore } from "react";
import type { Song } from "../types/song";
import { songs as seedSongs, getSongById as getSeedSongById } from "./songs";
import { useSupabaseSongs, saveSyncMapToAccount } from "./supabaseSongStore";
import type { YouTubeSearchResult } from "@/lib/youtube/types";
import type { SongsterrSource } from "@/lib/songsterr/types";

/**
 * Client-side view of user-imported songs. Account-backed imports are cached in
 * memory for the current session and stored in Supabase; localStorage is only
 * the fallback store for songs that have not been persisted to an account.
 */

const STORAGE_KEY = "learn-bass.imported-songs";
const EVENT = "learn-bass:songs-changed";
let sessionSongs: ImportedSong[] = [];
let sessionVersion = 0;

export interface ImportedSong extends Song {
  /** Epoch ms the song was imported. */
  createdAt: number;
  /** Original file names, for display only. */
  tabFileName: string;
  audioFileNames: string[];
  /** Supabase storage paths for account-backed imports. */
  tabStoragePath?: string;
  audioStoragePath?: string;
  /** Optional YouTube result the user paired with the imported tab/audio. */
  youtubeSource?: YouTubeSearchResult;
  /** Songsterr song the tab was downloaded from, when one was used. */
  songsterrSource?: SongsterrSource;
  /** True when this song is known to exist in the signed-in user's account. */
  persisted?: boolean;
}

function read(): ImportedSong[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImportedSong[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(next: ImportedSong[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

export function addImportedSong(song: ImportedSong): void {
  sessionSongs = [song, ...sessionSongs.filter((s) => s.id !== song.id)];
  sessionVersion += 1;
  if (song.persisted) {
    window.dispatchEvent(new Event(EVENT));
    return;
  }
  writeLocal([song, ...read().filter((s) => s.id !== song.id)]);
}

/**
 * Drops a song from the session cache, this device's store and its per-song
 * settings. The account copy (if any) is removed separately by
 * `deleteSongFromAccount`; see `deleteSong` for the whole sequence.
 */
export function removeImportedSong(id: string): void {
  if (typeof window === "undefined") return;
  sessionSongs = sessionSongs.filter((s) => s.id !== id);
  sessionVersion += 1;
  const local = read();
  const next = local.filter((s) => s.id !== id);
  // Account-backed songs are never in localStorage, so still fire the event.
  if (next.length === local.length) window.dispatchEvent(new Event(EVENT));
  else writeLocal(next);
  forgetSongSettings(id);
}

export function hasImportedSong(id: string): boolean {
  return sessionSongs.some((s) => s.id === id) || read().some((s) => s.id === id);
}

// --- React binding -------------------------------------------------------------

let cache: ImportedSong[] = [];
let cacheKey = "";

function getImportedSnapshot(): ImportedSong[] {
  // useSyncExternalStore needs a stable reference when nothing changed.
  const raw =
    typeof window === "undefined"
      ? "[]"
      : window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  const sessionKey = `${sessionVersion}:${sessionSongs.map((s) => s.id).join("|")}`;
  const nextKey = `${raw}|${sessionKey}`;
  if (nextKey !== cacheKey) {
    cacheKey = nextKey;
    const local = read();
    const seen = new Set(sessionSongs.map((s) => s.id));
    cache = [...sessionSongs, ...local.filter((s) => !seen.has(s.id))];
  }
  return cache;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const EMPTY: ImportedSong[] = [];

export function useImportedSongs(): ImportedSong[] {
  return useSyncExternalStore(subscribe, getImportedSnapshot, () => EMPTY);
}

/**
 * Everything the user has imported (newest first) plus any bundled song that
 * hasn't been installed into the store yet, so the library isn't empty while
 * the bundled assets are still downloading.
 */
export function useAllSongs(): Song[] {
  const imported = useImportedSongs();
  const remote = useSupabaseSongs();
  const installed = new Set(imported.map((s) => s.id));
  const visibleImported = [...imported];
  for (const song of remote) {
    if (!installed.has(song.id)) visibleImported.push(song);
  }
  const visible = new Set(visibleImported.map((s) => s.id));
  return [...visibleImported, ...seedSongs.filter((s) => !visible.has(s.id))];
}

export function useSongById(id: string): Song | undefined {
  const imported = useImportedSongs();
  const remote = useSupabaseSongs();
  return (
    imported.find((s) => s.id === id) ??
    remote.find((s) => s.id === id) ??
    getSeedSongById(id)
  );
}

// --- Preferred instrument (per song) -----------------------------------------

const PREFERRED_TRACK_KEY = "learn-bass.preferred-track";

function readPreferredTrackMap(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(PREFERRED_TRACK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The track index the user last viewed for this song, if any. */
export function getPreferredTrackIndex(songId: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  return readPreferredTrackMap()[songId];
}

export function setPreferredTrackIndex(songId: string, index: number): void {
  if (typeof window === "undefined") return;
  const map = readPreferredTrackMap();
  map[songId] = index;
  window.localStorage.setItem(PREFERRED_TRACK_KEY, JSON.stringify(map));
}

// --- Notation display (global) -----------------------------------------------

const TAB_ONLY_KEY = "learn-bass.tab-only";

/** Whether the score is rendered as tablature only (standard notation hidden). */
export function getTabOnly(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TAB_ONLY_KEY) === "1";
}

/**
 * The stored preference, or `undefined` when the user has never set one — the
 * player defaults it by screen size, which `getTabOnly` can't express.
 */
export function getStoredTabOnly(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(TAB_ONLY_KEY);
  return raw === null ? undefined : raw === "1";
}

export function setTabOnly(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TAB_ONLY_KEY, value ? "1" : "0");
}

// --- Score appearance (global) ----------------------------------------------

export interface ScoreAppearance {
  /** alphaTab display scale, where 1 is 100%. */
  scale: number;
  /** alphaTab layout stretch force. Lower values fit more notes per row. */
  stretch: number;
  /** Guitar tablature number font size, in CSS pixels. */
  tabNumberSize: number;
  /** Bar number font size, in CSS pixels. */
  barNumberSize: number;
  /** Text font family for tablature and bar numbers. */
  numberFontFamily: string;
  /** CSS hex color for the sheet surface behind the notation. */
  sheetColor: string;
  /** CSS hex color for primary notation glyphs and tab numbers. */
  inkColor: string;
  /** CSS hex color for staff lines. */
  staffLineColor: string;
  /** CSS hex color for bar numbers. */
  barNumberColor: string;
}

export const DEFAULT_SCORE_APPEARANCE: ScoreAppearance = {
  scale: 1,
  stretch: 0.8,
  tabNumberSize: 20,
  barNumberSize: 11,
  numberFontFamily: "Serif",
  sheetColor: "#FDF5E6",
  inkColor: "#000000",
  staffLineColor: "#a5a5a5",
  barNumberColor: "#c80000",
};

const SCORE_APPEARANCE_KEY = "learn-bass.score-appearance";

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeNumberFontFamily(value: unknown): string {
  if (
    value === "Arial" ||
    value === "IBM Plex Mono" ||
    value === "Serif" ||
    value === "Georgia" ||
    value === "Verdana"
  ) {
    return value;
  }
  return DEFAULT_SCORE_APPEARANCE.numberFontFamily;
}

export function sanitizeScoreAppearance(
  value: Partial<ScoreAppearance> | null | undefined,
): ScoreAppearance {
  return {
    scale: clampNumber(value?.scale, 0.75, 2, DEFAULT_SCORE_APPEARANCE.scale),
    stretch: clampNumber(
      value?.stretch,
      0.35,
      2,
      DEFAULT_SCORE_APPEARANCE.stretch,
    ),
    tabNumberSize: clampNumber(
      value?.tabNumberSize,
      10,
      22,
      DEFAULT_SCORE_APPEARANCE.tabNumberSize,
    ),
    barNumberSize: clampNumber(
      value?.barNumberSize,
      9,
      18,
      DEFAULT_SCORE_APPEARANCE.barNumberSize,
    ),
    numberFontFamily: sanitizeNumberFontFamily(value?.numberFontFamily),
    sheetColor: isHexColor(value?.sheetColor)
      ? value.sheetColor
      : DEFAULT_SCORE_APPEARANCE.sheetColor,
    inkColor: isHexColor(value?.inkColor)
      ? value.inkColor
      : DEFAULT_SCORE_APPEARANCE.inkColor,
    staffLineColor: isHexColor(value?.staffLineColor)
      ? value.staffLineColor
      : DEFAULT_SCORE_APPEARANCE.staffLineColor,
    barNumberColor: isHexColor(value?.barNumberColor)
      ? value.barNumberColor
      : DEFAULT_SCORE_APPEARANCE.barNumberColor,
  };
}

export function getScoreAppearance(): ScoreAppearance {
  if (typeof window === "undefined") return DEFAULT_SCORE_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(SCORE_APPEARANCE_KEY);
    return sanitizeScoreAppearance(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_SCORE_APPEARANCE;
  }
}

export function setScoreAppearance(value: ScoreAppearance): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SCORE_APPEARANCE_KEY,
    JSON.stringify(sanitizeScoreAppearance(value)),
  );
}

// --- Count-in (global) -------------------------------------------------------

const COUNT_IN_KEY = "learn-bass.count-in";

/**
 * Whether a bar of metronome clicks plays before playback starts. A practice
 * habit rather than a property of a song, so it is stored globally like the
 * notation mode.
 */
export function getCountIn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COUNT_IN_KEY) === "1";
}

export function setCountIn(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COUNT_IN_KEY, value ? "1" : "0");
}

// --- Audio sync settings (per song) ----------------------------------------------

export const AUDIO_SYNC_KEY = "learn-bass.audio-sync";
/**
 * Fired on `window` after any write to the sync settings. Unlike `storage` this
 * reaches listeners in the tab that did the writing, so the player can pick up
 * an anchor edited on the sync-debug page without a reload.
 */
export const AUDIO_SYNC_EVENT = "learn-bass:audio-sync-changed";

/**
 * A persisted score↔audio mapping. `points` are `{ scoreTime, audioTime }` in
 * seconds (see `features/player/data/syncMap.ts`); when present the player uses
 * this instead of `offsetMs`.
 */
/**
 * A manual correction: "this exact score position IS this exact recording
 * position". Anchors are authored by the user (waveform editor / nudge) and are
 * always applied *after* the automatic map, so they win.
 */
export interface SyncAnchor {
  scoreTime: number;
  audioTime: number;
  /** Optional note, e.g. "chorus 2 downbeat". */
  label?: string;
  createdAt?: number;
}

export interface StoredSyncMap {
  /** The automatic (DTW or offset) mapping, seconds, strictly monotone. */
  points: Array<{ scoreTime: number; audioTime: number; confidence?: number }>;
  /**
   * Manual anchors layered on top of `points`. Kept separate so re-running the
   * automatic pass never discards the user's corrections, and so the offline
   * refiner can be told which regions are already trusted.
   */
  anchors?: SyncAnchor[];
  /** e.g. "offset", "dtw:mrmsdtw", "dtw:mrmsdtw+anchors". */
  method: string;
  status: "ok" | "low-confidence";
  /** Score length the map was generated against, for staleness detection. */
  scoreEndSec?: number;
  /** Recording length the map was generated against. */
  audioDurationSec?: number;
  diagnostics?: Record<string, unknown>;
  createdAt: number;
}

export interface AudioSyncSettings {
  /** mp3 lead-in offset in ms — the fallback/manual mapping (offset + global fit). */
  offsetMs: number;
  /** Nonlinear score↔audio mapping (from DTW or manual anchors); preferred. */
  syncMap?: StoredSyncMap;
  /**
   * Import-time DTW readiness. New imports hold the player until this leaves
   * `pending`; manual retries do not need to block an already usable song.
   *
   * `queued` means the run was handed to CI (see the GitHub Action path in
   * `alignmentQueue`). It blocks just as `pending` does — the distinction is
   * only that the wait is minutes rather than seconds, and on someone else's
   * machine, which the loading overlay says out loud.
   */
  dtwStatus?: "pending" | "queued" | "ready" | "failed";
  /** Persisted "original recording" channel state. */
  backingVol?: number;
  backingMuted?: boolean;
  /** Persisted level for the synthesized reference tone of the shown track. */
  synthVol?: number;
  synthMuted?: boolean;
}

function readAudioSyncMap(): Record<string, AudioSyncSettings> {
  try {
    const raw = window.localStorage.getItem(AUDIO_SYNC_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getAudioSync(songId: string): AudioSyncSettings | undefined {
  if (typeof window === "undefined") return undefined;
  return readAudioSyncMap()[songId];
}

/** Shallow-merges `patch` into this device's stored sync settings for a song. */
function writeAudioSync(
  songId: string,
  patch: Partial<AudioSyncSettings>,
): void {
  if (typeof window === "undefined") return;
  const map = readAudioSyncMap();
  const current: AudioSyncSettings = map[songId] ?? { offsetMs: 0 };
  map[songId] = { ...current, ...patch };
  window.localStorage.setItem(AUDIO_SYNC_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(AUDIO_SYNC_EVENT));
}

/**
 * Shallow-merges `patch` into this song's stored sync settings.
 *
 * A patch that carries a `syncMap` is also pushed to the song's account row, so
 * a mapping solved once on this device travels with the song. That covers the
 * DTW result and any anchor the user edits afterwards, since both land here.
 * The push is fire-and-forget: the local write above is what playback reads,
 * and a signed-out or device-only song simply has no row to update.
 */
export function patchAudioSync(
  songId: string,
  patch: Partial<AudioSyncSettings>,
): void {
  if (typeof window === "undefined") return;
  writeAudioSync(songId, patch);
  // `in` rather than a truthiness test: clearing the map is a change to push
  // too, and it arrives as an explicit `syncMap: undefined`.
  if ("syncMap" in patch) {
    const map =
      patch.syncMap && patch.syncMap.points.length >= 2 ? patch.syncMap : null;
    void saveSyncMapToAccount(songId, map).catch((err) => {
      console.error("[songStore] could not save sync map to account", err);
    });
  }
}

/**
 * Installs a mapping fetched from the account onto this device. Unlike
 * `patchAudioSync` this does not push back to the account — the map came from
 * there, and echoing it would be a pointless round-trip on every open.
 */
export function applyRemoteSyncMap(songId: string, map: StoredSyncMap): void {
  writeAudioSync(songId, { syncMap: map, offsetMs: 0, dtwStatus: "ready" });
}

function withStoredSyncMap(
  songId: string,
  fn: (stored: StoredSyncMap | undefined) => StoredSyncMap | undefined,
): void {
  const settings = getAudioSync(songId);
  const next = fn(settings?.syncMap);
  if (next) {
    patchAudioSync(songId, { syncMap: next, offsetMs: 0 });
  }
}

/** Append or replace an anchor at the same scoreTime (within 5 ms). */
export function upsertSyncAnchor(songId: string, anchor: SyncAnchor): void {
  withStoredSyncMap(songId, (stored) => {
    const base: StoredSyncMap = stored ?? {
      points: [],
      method: "anchor-only",
      status: "ok",
      createdAt: Date.now(),
    };
    const anchors = [...(base.anchors ?? [])];
    const idx = anchors.findIndex(
      (a) => Math.abs(a.scoreTime - anchor.scoreTime) < 0.005,
    );
    const entry: SyncAnchor = {
      ...anchor,
      createdAt: anchor.createdAt ?? Date.now(),
    };
    if (idx >= 0) anchors[idx] = entry;
    else anchors.push(entry);
    anchors.sort((a, b) => a.scoreTime - b.scoreTime);
    return { ...base, anchors };
  });
}

export function removeSyncAnchor(songId: string, scoreTime: number): void {
  withStoredSyncMap(songId, (stored) => {
    if (!stored?.anchors?.length) return stored;
    const anchors = stored.anchors.filter(
      (a) => Math.abs(a.scoreTime - scoreTime) >= 0.005,
    );
    return { ...stored, anchors: anchors.length ? anchors : undefined };
  });
}

export function setSyncAnchors(songId: string, anchors: SyncAnchor[]): void {
  withStoredSyncMap(songId, (stored) => {
    const base: StoredSyncMap = stored ?? {
      points: [],
      method: "anchor-only",
      status: "ok",
      createdAt: Date.now(),
    };
    const sorted = [...anchors].sort((a, b) => a.scoreTime - b.scoreTime);
    return {
      ...base,
      anchors: sorted.length ? sorted : undefined,
    };
  });
}

// --- Per-song settings cleanup ------------------------------------------------

/**
 * Forgets everything keyed by song id in the settings maps — the preferred
 * track and the audio sync (offset, DTW map, anchors). Called on delete so a
 * re-import of the same file starts from a clean slate instead of inheriting a
 * mapping made against the old recording.
 */
function forgetSongSettings(songId: string): void {
  if (typeof window === "undefined") return;

  const tracks = readPreferredTrackMap();
  if (songId in tracks) {
    delete tracks[songId];
    window.localStorage.setItem(PREFERRED_TRACK_KEY, JSON.stringify(tracks));
  }

  const sync = readAudioSyncMap();
  if (songId in sync) {
    delete sync[songId];
    window.localStorage.setItem(AUDIO_SYNC_KEY, JSON.stringify(sync));
    window.dispatchEvent(new Event(AUDIO_SYNC_EVENT));
  }
}
