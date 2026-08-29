"use client";

import { useAllSongs } from "../data/songStore";
import { SongGrid } from "./SongGrid";

/** Client wrapper: merges seed songs with anything imported this session. */
export function LibrarySongGrid() {
  const songs = useAllSongs();
  return <SongGrid songs={songs} />;
}
