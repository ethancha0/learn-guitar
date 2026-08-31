"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { putBackingAudio } from "@/features/player/data/audioStore";
import { bytesToBase64 } from "./tabFile";
import type { ImportedSong } from "./songStore";

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
  created_at: string;
}

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

  const { error } = await supabase.from("songs").insert({
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
  });
  if (error) throw error;

  const persisted = {
    ...song,
    tabStoragePath: tabPath,
    audioStoragePath: audioPath,
    persisted: true,
  };
  dispatchSupabaseSongsChanged();
  return persisted;
}

async function downloadStorageBlob(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function hydrateSupabaseSong(songId: string): Promise<ImportedSong | null> {
  requireConfigured();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("songs")
    .select(
      "id,title,artist,duration_sec,bpm,difficulty,tab_path,audio_path,tab_file_name,audio_file_names,created_at",
    )
    .eq("id", songId)
    .single<SongRow>();
  if (error) return null;

  const song = toSong(data);
  const [tabBlob, audioBlob] = await Promise.all([
    downloadStorageBlob(song.tabStoragePath!),
    downloadStorageBlob(song.audioStoragePath!),
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

  const { data, error } = await supabase
    .from("songs")
    .select(
      "id,title,artist,duration_sec,bpm,difficulty,tab_path,audio_path,tab_file_name,audio_file_names,created_at",
    )
    .order("created_at", { ascending: false })
    .returns<SongRow[]>();
  if (error) throw error;
  return data.map(toSong);
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
