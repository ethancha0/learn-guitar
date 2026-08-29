import Link from "next/link";
import { Clock, Gauge, Music4, AudioLines } from "lucide-react";
import type { Song } from "../types/song";
import { formatDuration } from "./formatDuration";

const difficultyLabel: Record<Song["difficulty"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function SongCard({ song }: { song: Song }) {
  return (
    <Link
      href={`/player/${song.id}`}
      className="group flex flex-col gap-3 rounded-lg border border-white/5 bg-surface-raised p-4 transition-colors hover:border-accent/40 hover:bg-surface-overlay"
    >
      <div>
        <h3 className="font-medium text-zinc-100 group-hover:text-accent">{song.title}</h3>
        <p className="text-sm text-zinc-400">{song.artist}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(song.durationSec)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5" />
          {song.bpm} BPM
        </span>
        <span>{difficultyLabel[song.difficulty]}</span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Music4 className="h-3.5 w-3.5" />
          {song.hasTab ? "Tab ready" : "No tab"}
        </span>
        <span className="inline-flex items-center gap-1">
          <AudioLines className="h-3.5 w-3.5" />
          {song.hasAudio ? "Audio ready" : "No audio"}
        </span>
      </div>
    </Link>
  );
}
