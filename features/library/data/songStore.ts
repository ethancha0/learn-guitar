"use client";

import { useSyncExternalStore } from "react";
import type { Song } from "../types/song";
import { songs as seedSongs, getSongById as getSeedSongById } from "./songs";

/**
 * Client-side store for user-imported songs. The seed list in `songs.ts` stays
 * read-only; anything the user imports through the "Import song" dialog is kept
 * here and persisted to localStorage so the player route can resolve it.
 */

const STORAGE_KEY = "learn-bass.imported-songs";
const EVENT = "learn-bass:songs-changed";

export interface ImportedSong extends Song {
  /** Epoch ms the song was imported. */
  createdAt: number;
  /** Original file names, for display only. */
  tabFileName: string;
  audioFileNames: string[];
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

function write(next: ImportedSong[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

export function addImportedSong(song: ImportedSong): void {
  write([song, ...read()]);
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
  if (raw !== cacheKey) {
    cacheKey = raw;
    cache = read();
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

/** Seed songs plus everything the user has imported (imported first). */
export function useAllSongs(): Song[] {
  const imported = useImportedSongs();
  return [...imported, ...seedSongs];
}

export function useSongById(id: string): Song | undefined {
  const imported = useImportedSongs();
  return imported.find((s) => s.id === id) ?? getSeedSongById(id);
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

/** Shallow-merges `patch` into this song's stored sync settings. */
export function patchAudioSync(
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
