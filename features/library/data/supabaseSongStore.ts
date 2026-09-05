"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { putBackingAudio } from "@/features/player/data/audioStore";
import { bytesToBase64 } from "./tabFile";
import type { ImportedSong, StoredSyncMap } from "./songStore";
import type { YouTubeSearchResult } from "@/lib/youtube/types";

const BUCKET = "song-files";
export const SUPABASE_SONGS_EVENT = "learn-bass:supabase-songs-changed";

type Difficulty = ImportedSong["difficulty"];

interface SongRow {
  id: string;
  title: string;
  artist: string;
  duration_sec: number;
  bpm: number;
  difficulty: Difficulty;
  tab_path: string;
  audio_path: string;
  tab_file_name: string;
  audio_file_names: string[];
  youtube_source: YouTubeSearchResult | null;
  sync_map: StoredSyncMap | null;
  created_at: string;
}

type SongInsert = {
  id: string;
  user_id: string;
  title: string;
  artist: string;
  duration_sec: number;
  bpm: number;
  difficulty: Difficulty;
  tab_path: string;
  audio_path: string;
  tab_file_name: string;
  audio_file_names: string[];
  youtube_source?: YouTubeSearchResult | null;
};

function toSong(row: SongRow): ImportedSong {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: row.duration_sec,
    bpm: row.bpm,
    difficulty: row.difficulty,
    hasAudio: true,
    hasTab: true,
    createdAt: new Date(row.created_at).getTime(),
    tabFileName: row.tab_file_name,
    audioFileNames: row.audio_file_names ?? [],
    youtubeSource: row.youtube_source ?? undefined,
    tabStoragePath: row.tab_path,
    audioStoragePath: row.audio_path,
    persisted: true,
  };
}

function safePathPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file"
  );
}

function requireConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }
}

/**
 * Columns added after the first schema shipped. A project that has not run the
 * latest `supabase/schema.sql` is missing them, so every read and write drops
 * one and retries rather than failing the whole operation.
 */
export const OPTIONAL_COLUMNS = ["youtube_source", "sync_map"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const BASE_COLUMNS =
  "id,title,artist,duration_sec,bpm,difficulty,tab_path,audio_path,tab_file_name,audio_file_names,created_at";

export function columnList(omit: readonly OptionalColumn[]): string {
  const present = OPTIONAL_COLUMNS.filter((c) => !omit.includes(c));
  return present.length ? `${BASE_COLUMNS},${present.join(",")}` : BASE_COLUMNS;
}

/**
 * True when `error` is Postgres/PostgREST complaining that `column` does not
 * exist — 42703 on a read, PGRST204 (schema cache) on a write.
 */
export function isMissingColumn(error: unknown, column: string): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  if (code !== "42703" && code !== "PGRST204") return false;
  // PGRST204 does not always name the column; treat it as missing either way.
  return code === "PGRST204" || (message?.includes(column) ?? false);
}

/** The first optional column `error` blames that is not already dropped. */
function missingOptionalColumn(
  error: unknown,
  omit: readonly OptionalColumn[],
): OptionalColumn | undefined {
  return OPTIONAL_COLUMNS.find(
    (c) => !omit.includes(c) && isMissingColumn(error, c),
  );
}

interface QueryResult<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

/**
 * Runs a select, dropping optional columns one at a time for as long as the
 * database says they do not exist.
 */
export async function selectTolerantly<T>(
  run: (columns: string) => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const omit: OptionalColumn[] = [];
  for (;;) {
    const result = await run(columnList(omit));
    if (!result.error) return result;
    const missing = missingOptionalColumn(result.error, omit);
    if (!missing) return result;
    omit.push(missing);
  }
}

function isMissingYoutubeSourceColumn(error: unknown): boolean {
  return isMissingColumn(error, "youtube_source");
}

async function insertSongRow(row: SongInsert): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("songs").insert(row);
  if (!error) return;

  if (row.youtube_source !== undefined && isMissingYoutubeSourceColumn(error)) {
    const { youtube_source: _youtubeSource, ...legacyRow } = row;
    const retry = await supabase.from("songs").insert(legacyRow);
    if (!retry.error) return;
    throw retry.error;
  }

  throw error;
}

function selectSongRows() {
  const supabase = createClient();
  return selectTolerantly<SongRow[]>((columns) =>
    supabase
      .from("songs")
      .select(columns)
      .order("created_at", { ascending: false })
      .returns<SongRow[]>(),
  );
}

function selectSongRow(songId: string) {
  const supabase = createClient();
  return selectTolerantly<SongRow>((columns) =>
    supabase.from("songs").select(columns).eq("id", songId).single<SongRow>(),
  );
}

export function dispatchSupabaseSongsChanged(): void {
  window.dispatchEvent(new Event(SUPABASE_SONGS_EVENT));
}

export async function uploadSongToAccount({
  song,
  tabFile,
  audioFile,
}: {
  song: ImportedSong;
  tabFile: File;
  audioFile: File;
}): Promise<ImportedSong | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return null;

  const tabPath = `${user.id}/${song.id}/${safePathPart(tabFile.name)}`;
  const audioPath = `${user.id}/${song.id}/${safePathPart(audioFile.name)}`;

  const [tabUpload, audioUpload] = await Promise.all([
    supabase.storage
      .from(BUCKET)
      .upload(tabPath, tabFile, { contentType: tabFile.type || undefined }),
    supabase.storage
      .from(BUCKET)
      .upload(audioPath, audioFile, {
        contentType: audioFile.type || "audio/mpeg",
      }),
  ]);

  if (tabUpload.error) throw tabUpload.error;
  if (audioUpload.error) throw audioUpload.error;

  await insertSongRow({
    id: song.id,
    user_id: user.id,
    title: song.title,
    artist: song.artist,
    duration_sec: song.durationSec,
    bpm: song.bpm,
    difficulty: song.difficulty,
    tab_path: tabPath,
    audio_path: audioPath,
    tab_file_name: song.tabFileName,
    audio_file_names: song.audioFileNames,
    youtube_source: song.youtubeSource ?? null,
  });

  const persisted = {
    ...song,
    tabStoragePath: tabPath,
    audioStoragePath: audioPath,
    persisted: true,
  };
  dispatchSupabaseSongsChanged();
  return persisted;
}

/**
 * Stores a song's DTW mapping on its account row, so any device that opens the
 * song later gets the alignment with it. Best-effort by design: the map is
 * already saved locally by the time this runs, and a device-only song has no
 * row to update (the write simply matches nothing).
 *
 * `null` clears the stored mapping. That case matters: without it, resetting a
 * song's alignment here would leave the old map on the account, and the next
 * open would helpfully restore the very thing the user just discarded.
 */
export async function saveSyncMapToAccount(
  songId: string,
  map: StoredSyncMap | null,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("songs")
    .update({ sync_map: map })
    .eq("id", songId);

  if (error && isMissingColumn(error, "sync_map")) {
    console.warn(
      "[supabaseSongStore] songs.sync_map is missing — run supabase/schema.sql " +
        "to keep alignment across devices.",
    );
    return;
  }
  if (error) throw error;
}

/** The stored mapping for a song on the current account, if the row has one. */
export async function fetchSyncMapFromAccount(
  songId: string,
): Promise<StoredSyncMap | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await selectSongRow(songId);
  if (error || !data) return null;
  const map = data.sync_map;
  return map && Array.isArray(map.points) && map.points.length >= 2 ? map : null;
}

/**
 * Removes a song from the signed-in user's account: its stored tab/audio files
 * first, then the row. No-ops when Supabase is unconfigured, nobody is signed
 * in, or the song was never persisted — those songs only ever lived on device.
 */
export async function deleteSongFromAccount(songId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await selectSongRow(songId);
  // No row for this account (PGRST116) — nothing to delete remotely.
  if (error || !data) return;

  const paths = [data.tab_path, data.audio_path].filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove(paths);
    // A stranded blob is invisible to the user; a song that refuses to delete
    // is not. Log and still drop the row, which is what the library reads.
    if (storageError) {
      console.error("[supabaseSongStore] could not remove song files", storageError);
    }
  }

  const { error: deleteError } = await supabase
    .from("songs")
    .delete()
    .eq("id", songId);
  if (deleteError) throw deleteError;

  dispatchSupabaseSongsChanged();
}

async function withDownloadTimeout<T>(
  promise: Promise<T>,
  kind: "tab" | "audio",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out downloading the ${kind} file for this account song.`,
              ),
            ),
          120_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function downloadAccountSongBlob(
  row: SongRow,
  kind: "tab" | "audio",
): Promise<Blob> {
  const supabase = createClient();
  const storagePath = kind === "tab" ? row.tab_path : row.audio_path;
  const { data, error } = await withDownloadTimeout(
    supabase.storage.from(BUCKET).download(storagePath),
    kind,
  );
  if (error || !data) {
    throw new Error(
      error?.message ??
        `Could not download the ${kind} file for this account song.`,
    );
  }
  return data;
}

export async function hydrateSupabaseSong(songId: string): Promise<ImportedSong | null> {
  requireConfigured();
  const { data, error } = await selectSongRow(songId);
  if (error || !data) return null;

  const song = toSong(data);
  const [tabBlob, audioBlob] = await Promise.all([
    downloadAccountSongBlob(data, "tab"),
    downloadAccountSongBlob(data, "audio"),
  ]);
  const tabBytes = new Uint8Array(await tabBlob.arrayBuffer());
  await putBackingAudio(song.id, audioBlob);

  const hydrated = { ...song, tabData: bytesToBase64(tabBytes) };
  return hydrated;
}

async function fetchSupabaseSongs(): Promise<ImportedSong[]> {
  requireConfigured();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await selectSongRows();
  if (error) throw error;
  return (data ?? []).map(toSong);
}

export function useSupabaseSongs(): ImportedSong[] {
  const [songs, setSongs] = useState<ImportedSong[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    let cancelled = false;

    async function refresh() {
      try {
        const next = await fetchSupabaseSongs();
        if (!cancelled) setSongs(next);
      } catch (err) {
        console.error("[supabaseSongStore] could not load account songs", err);
        if (!cancelled) setSongs([]);
      }
    }

    void refresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    window.addEventListener(SUPABASE_SONGS_EVENT, refresh);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener(SUPABASE_SONGS_EVENT, refresh);
    };
  }, []);

  return songs;
}
