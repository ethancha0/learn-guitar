import { cn } from "@/lib/cn";
import type { Song } from "../types/song";
import { SongRow } from "./SongRow";
import { CATALOGUE_COLUMNS, DESKTOP_ONLY_CELL } from "./catalogueColumns";

/**
 * The library as a ruled catalogue: a header row plus one line per song,
 * separated by hairlines. A deliberate index rather than a grid of cards.
 */
export function SongGrid({ songs }: { songs: Song[] }) {
  if (songs.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-rule p-8 text-center font-display text-[15px] italic text-ink-muted">
        No songs yet. Importing files will land here.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          CATALOGUE_COLUMNS,
          "border-b border-rule-strong px-1 pb-[7px] font-mono text-[9.5px] uppercase tracking-label text-ink-faint",
        )}
      >
        <span>No.</span>
        <span>Title</span>
        <span className={DESKTOP_ONLY_CELL}>Artist</span>
        <span className="col-start-3 row-start-1 text-right md:col-auto">
          Length
        </span>
        <span className={cn(DESKTOP_ONLY_CELL, "text-right")}>Tempo</span>
        <span className={DESKTOP_ONLY_CELL}>Grade</span>
        <span className={cn(DESKTOP_ONLY_CELL, "text-right")}>Files</span>
      </div>
      {songs.map((song, i) => (
        <SongRow key={song.id} song={song} index={i} />
      ))}
    </div>
  );
}
