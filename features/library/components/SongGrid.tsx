import type { Song } from "../types/song";
import { SongCard } from "./SongCard";

export function SongGrid({ songs }: { songs: Song[] }) {
  if (songs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
        No songs yet. Importing files will land here.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {songs.map((song) => (
        <SongCard key={song.id} song={song} />
      ))}
    </div>
  );
}
