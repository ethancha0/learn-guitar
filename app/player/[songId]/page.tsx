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
        <div className="flex min-h-[calc(100dvh-3rem)] items-center justify-center text-sm text-zinc-500">
          Loading song…
        </div>
      );
    }
    notFound();
  }

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/library"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Library
          </Link>
          <h1 className="mt-1 text-lg font-semibold">{song.title}</h1>
          <p className="text-sm text-zinc-400">
            {song.artist} · {song.bpm} BPM
          </p>
        </div>
      </div>

      {song.tabData ? (
        <AlphaTabPlayer songId={songId} tabData={song.tabData} />
      ) : (
        <>
          <ScoreView />
          <TransportBar durationSec={song.durationSec} />
        </>
      )}
      <FeedbackPanel grade={mockGrade} />
    </div>
  );
}
