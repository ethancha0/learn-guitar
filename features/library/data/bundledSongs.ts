"use client";

import { getBackingAudio, putBackingAudio } from "@/features/player/data/audioStore";
import { bundledSongs, type BundledSong } from "./songs";
import { addImportedSong, hasImportedSong, type ImportedSong } from "./songStore";
import { bytesToBase64 } from "./tabFile";

/**
 * Copies the songs shipped in `public/songs/` into the local song store the
 * first time the app runs in a browser. Once installed they're indistinguishable
 * from a user import, so the player, sync map and audio stores all work the same.
 */

async function install(song: BundledSong): Promise<void> {
  const [tabRes, audioRes] = await Promise.all([
    fetch(song.tabUrl),
    fetch(song.audioUrl),
  ]);
  if (!tabRes.ok) throw new Error(`Missing tab file: ${song.tabUrl}`);
  if (!audioRes.ok) throw new Error(`Missing audio file: ${song.audioUrl}`);

  const [tabBuffer, audioBlob] = await Promise.all([
    tabRes.arrayBuffer(),
    audioRes.blob(),
  ]);

  await putBackingAudio(
    song.id,
    audioBlob.type.startsWith("audio/")
      ? audioBlob
      : new Blob([audioBlob], { type: "audio/mpeg" }),
  );

  const { tabUrl: _tabUrl, audioUrl: _audioUrl, audioFileName, ...meta } = song;
  const entry: ImportedSong = {
    ...meta,
    tabData: bytesToBase64(new Uint8Array(tabBuffer)),
    createdAt: Date.now(),
    audioFileNames: [audioFileName],
  };
  addImportedSong(entry);
}

let pending: Promise<void> | undefined;

export function installBundledSongs(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  pending ??= Promise.all(
    bundledSongs.map(async (song) => {
      // Audio lives in IndexedDB and can be evicted independently of the
      // localStorage metadata, so both halves have to be present to skip.
      if (hasImportedSong(song.id) && (await getBackingAudio(song.id))) return;
      await install(song);
    }),
  ).then(() => undefined);
  return pending;
}
