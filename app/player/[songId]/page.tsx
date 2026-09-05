"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addImportedSong,
  useSongById,
} from "@/features/library/data/songStore";
import { hydrateSupabaseSong } from "@/features/library/data/supabaseSongStore";
import { ScoreView } from "@/features/player/components/ScoreView";
import { TransportBar } from "@/features/player/components/TransportBar";
import {
  AlphaTabPlayer,
  type ScoreMeta,
} from "@/features/player/components/AlphaTabPlayer";
import { SongMasthead } from "@/features/player/components/SongMasthead";
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
  // Tuning and metre are only known once alphaTab has parsed the score, and
  // they arrive in two separate passes, so they accumulate here.
  const [scoreMeta, setScoreMeta] = useState<ScoreMeta>({});

  const handleScoreMeta = useCallback(
    (next: ScoreMeta) => setScoreMeta((prev) => ({ ...prev, ...next })),
    [],
  );

  useEffect(() => setScoreMeta({}), [songId]);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    setAccountChecked(false);
    setAccountLoadError(null);
  }, [songId]);

  useEffect(() => {
    if (!hydrated || song?.tabData || accountChecked) return;

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
  }, [accountChecked, hydrated, song?.tabData, songId]);

  if (!song) {
    // Account songs are hydrated after mount, so wait before deciding a song
    // truly doesn't exist.
    if (!hydrated) {
      return (
        <div className="flex flex-1 items-center justify-center font-display text-[15px] italic text-ink-muted">
          Loading song…
        </div>
      );
    }
    if (checkingAccount || !accountChecked) {
      return (
        <div className="flex flex-1 items-center justify-center font-display text-[15px] italic text-ink-muted">
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
      <SongMasthead song={song} meta={scoreMeta} />

      {song.tabData ? (
        <AlphaTabPlayer
          songId={songId}
          tabData={song.tabData}
          onScoreMeta={handleScoreMeta}
        />
      ) : accountLoadError ? (
        <AccountSongError message={accountLoadError} />
      ) : song.persisted && (checkingAccount || !accountChecked) ? (
        <div className="flex flex-1 items-center justify-center font-display text-[15px] italic text-ink-muted">
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
      <div className="max-w-md rounded-sm border border-accent bg-accent-wash p-5 text-left">
        <p className="font-mono text-[9.5px] uppercase tracking-label text-accent">
          Could not load account song
        </p>
        <p className="mt-2 font-display text-[15px] italic text-ink">{message}</p>
        <Link
          href="/library"
          className="mt-4 inline-flex border-b border-ink font-mono text-[11px] uppercase tracking-button text-ink"
        >
          Back to library
        </Link>
      </div>
    </div>
  );
}
