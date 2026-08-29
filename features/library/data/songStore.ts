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
