import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Song } from "@/features/library/types/song";
import type { ScoreMeta } from "./AlphaTabPlayer";

/**
 * The player's two-part masthead on an engraved rule: title block on the left,
 * a metadata block of label/value pairs on the right. Tempo lives here rather
 * than trailing the artist name.
 */
export function SongMasthead({
  song,
  meta,
}: {
  song: Song;
  meta: ScoreMeta;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b-2 border-rule-strong pb-2.5">
      <div className="min-w-0">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft className="h-3 w-3" />
          Library
        </Link>
        <h1 className="mt-1.5 truncate font-display text-2xl font-bold leading-none tracking-[-0.025em] text-ink md:text-[32px]">
          {song.title}
        </h1>
        <p className="mt-1 truncate font-display text-[15px] italic text-ink-muted">
          {song.artist}
        </p>
      </div>

      {/* Hidden on phones, where the score wants the vertical space. */}
      <dl className="hidden shrink-0 gap-[22px] text-right md:flex">
        <MetaPair label="Tempo" value={song.bpm ? String(song.bpm) : undefined} />
        <MetaPair label="Metre" value={meta.metre} />
        <MetaPair label="Tuning" value={meta.tuning} tracked />
      </dl>
    </div>
  );
}

/** An unavailable value reads as an em dash rather than vanishing. */
function MetaPair({
  label,
  value,
  tracked,
}: {
  label: string;
  value?: string;
  tracked?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <dt className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
        {label}
      </dt>
      <dd
        className={
          value
            ? `font-mono text-[15px] text-ink${tracked ? " tracking-[0.14em]" : ""}`
            : "font-mono text-[15px] text-ink-ghost"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
