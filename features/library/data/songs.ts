import type { Song } from "../types/song";

/**
 * Songs shipped with the app. The files live under `public/songs/` and are
 * installed into the local song store on first load (see `bundledSongs.ts`),
 * so from then on they behave exactly like a user import.
 */
export interface BundledSong extends Song {
  tabUrl: string;
  audioUrl: string;
  tabFileName: string;
  audioFileName: string;
}

export const bundledSongs: BundledSong[] = [
  {
    id: "monster",
    title: "Monster",
    artist: "Yoasobi",
    durationSec: 206,
    bpm: 170,
    difficulty: "intermediate",
    hasAudio: true,
    hasTab: true,
    tabUrl: "/songs/monster/monster.gp",
    audioUrl: "/songs/monster/monster.mp3",
    tabFileName: "monster.gp",
    audioFileName: "monster.mp3",
  },
];

/** Every song that exists before the user imports anything. */
export const songs: Song[] = bundledSongs;

export function getSongById(id: string): Song | undefined {
  return songs.find((song) => song.id === id);
}
