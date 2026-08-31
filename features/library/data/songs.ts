import type { Song } from "../types/song";

/** Optional songs that can be shipped with the app. */
export interface BundledSong extends Song {
  tabUrl: string;
  audioUrl: string;
  tabFileName: string;
  audioFileName: string;
}

export const bundledSongs: BundledSong[] = [];

/** Every song that exists before the user imports anything. */
export const songs: Song[] = [];

export function getSongById(id: string): Song | undefined {
  return songs.find((song) => song.id === id);
}
