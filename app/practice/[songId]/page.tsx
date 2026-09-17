"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addImportedSong,
  useSongById,
} from "@/features/library/data/songStore";
import { hydrateSupabaseSong } from "@/features/library/data/supabaseSongStore";
import { PracticeStage } from "@/features/practice/components/PracticeStage";

export default function PracticePage({
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
        console.error("[PracticePage] could not hydrate account song", err);
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

  if (!song || !song.tabData) {
    if (!hydrated) {
      return <PracticeLoading text="Loading song…" />;
    }
    if (checkingAccount || !accountChecked) {
      return <PracticeLoading text="Loading account song…" />;
    }
    if (accountLoadError) {
      return <PracticeError message={accountLoadError} />;
    }
    if (!song) notFound();
    return (
      <PracticeError message="This song has no tab imported yet — open it in the player and import one first." />
    );
  }

  return <PracticeStage songId={songId} song={song} tabData={song.tabData} />;
}

function PracticeLoading({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center font-display text-[15px] italic text-ink-muted">
      {text}
    </div>
  );
}

function PracticeError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center">
      <div className="max-w-md rounded-sm border border-accent bg-accent-wash p-5 text-left">
        <p className="font-mono text-[9.5px] uppercase tracking-label text-accent">
          Could not open rhythm practice
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
