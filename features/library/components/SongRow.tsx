import Link from "next/link";
import { Music4, AudioLines } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Song } from "../types/song";
import { formatDuration } from "./formatDuration";
import { CATALOGUE_COLUMNS, DESKTOP_ONLY_CELL } from "./catalogueColumns";

const difficultyLabel: Record<Song["difficulty"], string> = {
  beginner: "Beg",
  intermediate: "Int",
  advanced: "Adv",
};

/** Rule length stands in for difficulty: 9px per level. */
const difficultyLevel: Record<Song["difficulty"], number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

/**
 * One entry in the ruled catalogue. Not a card — a row of a printed index,
 * closed by a hairline and carrying no border, fill or radius of its own.
 */
export function SongRow({ song, index }: { song: Song; index: number }) {
  return (
    <Link
      href={`/player/${song.id}`}
      className={cn(
        CATALOGUE_COLUMNS,
        "group border-b border-rule px-1 py-[13px] text-ink transition-colors hover:bg-[var(--wash-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
      )}
    >
      <span className="col-start-1 row-start-1 row-span-2 self-center font-mono text-xs font-semibold text-accent md:col-auto md:row-auto md:row-span-1">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="col-start-2 row-start-1 truncate font-display text-[19px] font-semibold tracking-[-0.015em] transition-colors group-hover:text-accent md:col-auto md:row-auto">
        {song.title}
      </span>
      <span className="col-start-2 row-start-2 truncate font-display text-sm italic text-ink-muted md:col-auto md:row-auto">
        {song.artist}
      </span>
      <span className="col-start-3 row-start-2 text-right font-mono text-xs md:col-auto md:row-auto">
        {formatDuration(song.durationSec)}
      </span>
      {/* Bare number — the unit lives in the column header. */}
      <span className={cn(DESKTOP_ONLY_CELL, "text-right font-mono text-xs")}>
        {song.bpm}
      </span>
      <span className="hidden items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-button text-ink-muted md:flex">
        <span
          aria-hidden
          className="inline-block h-[3px] bg-ink"
          style={{ width: `${difficultyLevel[song.difficulty] * 9}px` }}
        />
        {difficultyLabel[song.difficulty]}
      </span>
      <span className="col-start-3 row-start-1 inline-flex justify-self-end gap-[7px] text-ink-faint md:col-auto md:row-auto">
        {song.hasTab && <Music4 className="h-3.5 w-3.5" aria-label="Tab ready" />}
        {song.hasAudio && (
          <AudioLines className="h-3.5 w-3.5" aria-label="Audio ready" />
        )}
      </span>
    </Link>
  );
}
