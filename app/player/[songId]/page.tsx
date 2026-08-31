"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  addImportedSong,
  useSongById,
} from "@/features/library/data/songStore";
import { hydrateSupabaseSong } from "@/features/library/data/supabaseSongStore";
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
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [accountChecked, setAccountChecked] = useState(false);
  const [accountLoadError, setAccountLoadError] = useState<string | null>(null);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    setAccountChecked(false);
    setAccountLoadError(null);
  }, [songId]);

  useEffect(() => {
    if (!hydrated || song?.tabData || checkingAccount || accountChecked) return;

    let cancelled = false;
    setCheckingAccount(true);
    setAccountLoadError(null);
    hydrateSupabaseSong(songId)
      .then((remoteSong) => {
        if (cancelled) return;
        if (remoteSong) {
          addImportedSong(remoteSong);
        } else {
          setAccountLoadError("That song was not found in your account.");
        }
      })
      .catch((err) => {
        console.error("[PlayerPage] could not hydrate account song", err);
        setAccountLoadError(
          err instanceof Error
            ? err.message
            : "Could not download this song from your account.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingAccount(false);
          setAccountChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountChecked, checkingAccount, hydrated, song?.tabData, songId]);

  if (!song) {
    // Account songs are hydrated after mount, so wait before deciding a song
    // truly doesn't exist.
    if (!hydrated) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          Loading song…
        </div>
      );
    }
    if (checkingAccount || !accountChecked) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          Loading account song…
        </div>
      );
    }
    if (accountLoadError) {
      return <AccountSongError message={accountLoadError} />;
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
      ) : accountLoadError ? (
        <AccountSongError message={accountLoadError} />
      ) : song.persisted && (checkingAccount || !accountChecked) ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          Loading account song…
        </div>
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

function AccountSongError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center">
      <div className="max-w-md rounded-lg border border-red-500/20 bg-red-500/5 p-5">
        <p className="text-sm font-medium text-red-100">
          Could not load account song
        </p>
        <p className="mt-2 text-sm text-red-200/80">{message}</p>
        <Link
          href="/library"
          className="mt-4 inline-flex text-sm text-accent hover:text-accent-muted"
        >
          Back to library
        </Link>
      </div>
    </div>
  );
}
