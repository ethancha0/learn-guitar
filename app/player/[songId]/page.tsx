"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useSongById } from "@/features/library/data/songStore";
import { ScoreView } from "@/features/player/components/ScoreView";
import { TransportBar } from "@/features/player/components/TransportBar";
import { AlphaTabPlayer } from "@/features/player/components/AlphaTabPlayer";
import { FeedbackPanel } from "@/features/player/components/FeedbackPanel";
import { mockGrade } from "@/features/player/data/mockGrade";

export default function PlayerPage({
  params,
}: {
  params: Promise<{ songId: string }>;
}) {
  const { songId } = use(params);
  const song = useSongById(songId);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  if (!song) {
    // Imported songs live in localStorage, so wait for hydration before
    // deciding a song truly doesn't exist.
    if (!hydrated) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          Loading song…
        </div>
      );
    }
    notFound();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:gap-4">
      {/* On phones the song header collapses to a single line so the score
          keeps the vertical space. */}
      <div className="flex min-w-0 items-baseline gap-2 md:block">
        <Link
          href="/library"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Library</span>
        </Link>
        <h1 className="mt-0 min-w-0 flex-1 truncate text-base font-semibold md:mt-1 md:text-lg">
          {song.title}
        </h1>
        <p className="shrink-0 truncate text-xs text-zinc-400 md:text-sm">
          {song.artist} · {song.bpm} BPM
        </p>
      </div>

      {song.tabData ? (
        <AlphaTabPlayer songId={songId} tabData={song.tabData} />
      ) : (
        <>
          <ScoreView />
          <TransportBar durationSec={song.durationSec} />
        </>
      )}

      {/* Mock scoring readout — not worth phone screen space yet. */}
      <div className="hidden md:block">
        <FeedbackPanel grade={mockGrade} />
      </div>
    </div>
  );
}
