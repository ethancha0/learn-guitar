import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSongById } from "@/features/library/data/songs";
import { ScoreView } from "@/features/player/components/ScoreView";
import { TransportBar } from "@/features/player/components/TransportBar";
import { FeedbackPanel } from "@/features/player/components/FeedbackPanel";
import { mockGrade } from "@/features/player/data/mockGrade";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ songId: string }>;
}) {
  const { songId } = await params;
  const song = getSongById(songId);

  if (!song) {
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

      <ScoreView />
      <TransportBar durationSec={song.durationSec} />
      <FeedbackPanel grade={mockGrade} />
    </div>
  );
}
