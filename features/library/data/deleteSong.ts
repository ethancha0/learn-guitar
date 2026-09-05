"use client";

import { deleteBackingAudio } from "@/features/player/data/audioStore";
import { removeImportedSong } from "./songStore";
import { deleteSongFromAccount } from "./supabaseSongStore";

/**
 * Removes a song from everywhere it lives: the account (Supabase row + stored
 * files), this device's song list and per-song settings, and the cached backing
 * audio in IndexedDB.
 *
 * The account goes first and is allowed to throw — a failure there leaves the
 * song whole and retryable, which is better than a row that survives a library
 * the user has already watched it disappear from. The IndexedDB blob is the
 * opposite case: it is unreachable once the song is gone from the list, so a
 * failure to evict it is not worth failing the delete over.
 */
export async function deleteSong(songId: string): Promise<void> {
  await deleteSongFromAccount(songId);
  removeImportedSong(songId);
  try {
    await deleteBackingAudio(songId);
  } catch (err) {
    console.error("[deleteSong] could not evict cached audio", err);
  }
}
