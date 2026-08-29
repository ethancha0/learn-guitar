import type { Song } from "../types/song";

/** Mock library. Replaced by real imported-file metadata later. */
export const songs: Song[] = [
  {
    id: "come-together",
    title: "Come Together",
    artist: "The Beatles",
    durationSec: 259,
    bpm: 82,
    difficulty: "beginner",
    hasAudio: true,
    hasTab: true,
  },
  {
    id: "another-one-bites-the-dust",
    title: "Another One Bites the Dust",
    artist: "Queen",
    durationSec: 215,
    bpm: 110,
    difficulty: "beginner",
    hasAudio: true,
    hasTab: true,
  },
  {
    id: "hysteria",
    title: "Hysteria",
    artist: "Muse",
    durationSec: 227,
    bpm: 140,
    difficulty: "advanced",
    hasAudio: false,
    hasTab: true,
  },
  {
    id: "the-lemon-song",
    title: "The Lemon Song",
    artist: "Led Zeppelin",
    durationSec: 379,
    bpm: 122,
    difficulty: "intermediate",
    hasAudio: true,
    hasTab: false,
  },
];

export function getSongById(id: string): Song | undefined {
  return songs.find((song) => song.id === id);
}
