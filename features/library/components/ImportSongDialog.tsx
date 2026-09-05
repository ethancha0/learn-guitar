"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  AudioLines,
  Check,
  ExternalLink,
  FileMusic,
  Guitar,
  Loader2,
  Search,
  X,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import {
  addImportedSong,
  setPreferredTrackIndex,
  type ImportedSong,
} from "../data/songStore";
import {
  uploadSongToAccount,
  dispatchSupabaseSongsChanged,
} from "../data/supabaseSongStore";
import { bytesToBase64 } from "../data/tabFile";
import { putBackingAudio } from "@/features/player/data/audioStore";
import { queueAlignment } from "@/features/player/data/alignmentQueue";
import { Select } from "@/components/ui/Select";
import type { YouTubeSearchResult } from "@/lib/youtube/types";
import type {
  SongsterrSong,
  SongsterrTrack,
} from "@/lib/songsterr/types";
import { tuningLabel } from "@/lib/songsterr/tuning";
import type { Song } from "../types/song";
import { formatDuration } from "./formatDuration";

const MotionButton = motion.create(Button);

const overlayVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1 },
};

const listVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

type ImportStage = "compose" | "generating" | "success";

const TAB_EXTENSIONS = [
  ".gp",
  ".gp3",
  ".gp4",
  ".gp5",
  ".gp6",
  ".gp7",
  ".gp8",
  ".gpx",
  ".ptb",
];
const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".webm", ".flac", ".wav"];

function hasAllowedExtension(name: string, allowed: string[]): boolean {
  const lower = name.toLowerCase();
  return allowed.some((ext) => lower.endsWith(ext));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "song"
  );
}

/** A bare id or anything on songsterr.com is a direct lookup, not a search. */
function looksLikeSongsterrLink(value: string): boolean {
  const raw = value.trim();
  return /songsterr\.com/i.test(raw) || /^\d+$/.test(raw);
}

/** Songsterr rates tabs 1-5; the library only models three bands. */
function difficultyFromSongsterr(value?: number): Song["difficulty"] | undefined {
  if (value === undefined) return undefined;
  if (value <= 2) return "beginner";
  if (value <= 3) return "intermediate";
  return "advanced";
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function formatPublishedDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear().toString();
}

function fileNameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const quoted = value.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = value.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim() ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** `X-Songsterr-Part-Ids` is the Songsterr track index of each track in the GP file. */
function parsePartIds(header: string | null): number[] {
  if (!header?.trim()) return [];
  return header
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));
}

function accountSyncErrorMessage(err: unknown): string {
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  return message
    ? `Saved on this device, but account sync failed: ${message}`
    : "Saved on this device, but account sync failed. Check your Supabase setup and try signing in again.";
}

function isQuotaExceededError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}

/** Best-effort read of an audio file's duration; falls back to 0 on failure. */
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0);
    audio.onerror = () => done(0);
    // Some codecs never fire metadata events in every browser; don't hang import.
    setTimeout(() => done(0), 5000);
    audio.src = url;
  });
}

interface DropZoneProps {
  title: string;
  hint: string;
  icon: React.ReactNode;
  accept: string;
  multiple?: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
  allowed: string[];
  /** Flags this zone as the remaining blocker once the other inputs are done. */
  needed?: boolean;
  busy?: boolean;
}

function DropZone({
  title,
  hint,
  icon,
  accept,
  multiple,
  files,
  onFiles,
  allowed,
  needed,
  busy,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function accept_(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list).filter((f) =>
      hasAllowedExtension(f.name, allowed),
    );
    if (next.length) onFiles(multiple ? next : next.slice(0, 1));
  }

  return (
    <div
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        accept_(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-2 rounded-sm border border-dashed border-rule px-6 py-8 text-center transition-colors",
        needed && !files.length && "border-accent/50 bg-accent-wash",
        files.length && "border-accent/40",
        dragging && "border-accent/70 bg-accent/5",
      )}
    >
      <div className="text-zinc-400">{icon}</div>
      <p className="text-base font-medium text-zinc-200">{title}</p>
      <p className={cn("text-xs text-zinc-500", needed && !files.length && "text-accent")}>
        {needed && !files.length ? "Required to finish" : hint}
      </p>

      {busy ? (
        <div className="mt-1 flex items-center gap-2 text-xs text-accent">
          <Loader2 className="h-4 w-4 animate-spin" />
          Downloading…
        </div>
      ) : (
        files.length > 0 && (
          <ul className="mt-1 w-full space-y-0.5 text-xs text-accent">
            {files.map((f) => (
              <li key={f.name} className="truncate">
                {f.name}
              </li>
            ))}
          </ul>
        )
      )}

      <MotionButton
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        whileHover={busy ? undefined : { scale: 1.02 }}
        whileTap={busy ? undefined : { scale: 0.98 }}
      >
        Browse…
      </MotionButton>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={busy}
        className="hidden"
        onChange={(e) => accept_(e.target.files)}
      />
    </div>
  );
}

function SearchSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <motion.div
          key={index}
          className="rounded-sm border border-rule bg-paper p-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut", delay: index * 0.04 }}
        >
          <motion.div
            className="h-3.5 w-3/4 bg-ink/10"
            animate={{ opacity: [0.35, 0.8, 0.35] }}
            transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="mt-2 h-2.5 w-1/2 bg-ink/10"
            animate={{ opacity: [0.25, 0.65, 0.25] }}
            transition={{
              duration: 1.05,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.08,
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

function GeneratingState() {
  return (
    <motion.div
      key="generating"
      className="flex min-h-[360px] flex-col items-center justify-center gap-5 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="flex h-14 w-14 items-end justify-center gap-1 border border-rule bg-paper px-3 py-3">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 bg-accent"
            animate={{ height: ["35%", "100%", "45%"] }}
            transition={{
              duration: 0.72,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.08,
            }}
          />
        ))}
      </div>
      <div className="space-y-1">
        <p className="font-display text-2xl font-bold text-ink">
          Generating tab…
        </p>
        <p className="font-display text-sm italic text-ink-muted">
          Saving the chart and preparing synced playback.
        </p>
      </div>
      <div className="h-1 w-64 overflow-hidden bg-track">
        <motion.div
          className="h-full w-1/2 bg-accent"
          animate={{ x: ["-100%", "220%"] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    </motion.div>
  );
}

function SuccessState() {
  return (
    <motion.div
      key="success"
      className="flex min-h-[360px] flex-col items-center justify-center gap-5 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <motion.div
        className="grid h-16 w-16 place-items-center border border-accent bg-accent-wash text-accent"
        initial={{ scale: 0.88 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 22 }}
      >
        <motion.svg
          viewBox="0 0 24 24"
          className="h-8 w-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <motion.path
            d="M20 6 9 17l-5-5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.28, ease: "easeOut", delay: 0.05 }}
          />
        </motion.svg>
      </motion.div>
      <div className="space-y-1">
        <p className="font-display text-2xl font-bold text-ink">Ready</p>
        <p className="font-display text-sm italic text-ink-muted">
          Opening the player.
        </p>
      </div>
    </motion.div>
  );
}

export function ImportSongDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<ImportStage>("compose");
  const [tabFiles, setTabFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [youtubeQuery, setYoutubeQuery] = useState("");
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([]);
  const [selectedYoutube, setSelectedYoutube] =
    useState<YouTubeSearchResult | null>(null);
  const [youtubeSearching, setYoutubeSearching] = useState(false);
  const [youtubeDownloadingId, setYoutubeDownloadingId] = useState<string | null>(
    null,
  );
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [songsterrQuery, setSongsterrQuery] = useState("");
  const [songsterrResults, setSongsterrResults] = useState<SongsterrSong[]>([]);
  const [songsterrSong, setSongsterrSong] = useState<SongsterrSong | null>(null);
  const [songsterrTrackIndex, setSongsterrTrackIndex] = useState<number | null>(
    null,
  );
  const [songsterrLoading, setSongsterrLoading] = useState(false);
  const [songsterrError, setSongsterrError] = useState<string | null>(null);
  const [tabDownloading, setTabDownloading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);
  /** Songsterr track index of each track in the downloaded Guitar Pro file. */
  const [tabPartIds, setTabPartIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ignore a download that finished after the user picked a different song. */
  const songsterrDownloadIdRef = useRef<number | null>(null);

  const ready =
    tabFiles.length > 0 && audioFiles.length > 0 && !tabDownloading;
  const missing = [
    tabDownloading
      ? "the Songsterr tab to finish downloading"
      : tabFiles.length === 0
        ? "a Guitar Pro tab file"
        : null,
    audioFiles.length === 0 ? "an audio file" : null,
  ].filter((item): item is string => item !== null);
  const songsterrTrack: SongsterrTrack | null =
    songsterrSong?.tracks.find((track) => track.index === songsterrTrackIndex) ??
    null;

  function reset() {
    setTabFiles([]);
    setAudioFiles([]);
    setYoutubeQuery("");
    setYoutubeResults([]);
    setSelectedYoutube(null);
    setYoutubeSearching(false);
    setYoutubeDownloadingId(null);
    setYoutubeError(null);
    setSongsterrQuery("");
    setSongsterrResults([]);
    setSongsterrSong(null);
    setSongsterrTrackIndex(null);
    setSongsterrLoading(false);
    setSongsterrError(null);
    setTabDownloading(false);
    setTabError(null);
    setTabPartIds([]);
    songsterrDownloadIdRef.current = null;
    setBusy(false);
    setError(null);
    setStage("compose");
  }

  async function handleFinish() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setStage("generating");

    try {
      const tabFile = tabFiles[0];
      const [durationSec, tabBytes] = await Promise.all([
        readAudioDuration(audioFiles[0]),
        tabFile.arrayBuffer().then((buf) => new Uint8Array(buf)),
      ]);
      const tabData = bytesToBase64(tabBytes);
      // Songsterr's catalogue metadata beats a YouTube uploader's video title.
      const title =
        songsterrSong?.title ||
        (selectedYoutube && decodeHtmlEntities(selectedYoutube.title)) ||
        titleFromFileName(tabFile.name) ||
        "Imported song";
      const id = `${slugify(title)}-${Date.now().toString(36)}`;

      // Audio can be several MB, so it goes to IndexedDB rather than localStorage.
      try {
        await putBackingAudio(id, audioFiles[0]);
      } catch (err) {
        if (isQuotaExceededError(err)) {
          setBusy(false);
          setError(
            "That audio file is too large to store on this device. Try a shorter YouTube result or import a smaller local audio file.",
          );
          return;
        }
        throw err;
      }

      const song: ImportedSong = {
        id,
        title,
        artist:
          songsterrSong?.artist ||
          (selectedYoutube
            ? decodeHtmlEntities(selectedYoutube.channelTitle)
            : "Imported"),
        durationSec: durationSec || selectedYoutube?.durationSec || 0,
        bpm: 120,
        difficulty:
          difficultyFromSongsterr(songsterrTrack?.difficulty) ?? "intermediate",
        hasAudio: true,
        hasTab: true,
        tabData,
        createdAt: Date.now(),
        tabFileName: tabFile.name,
        audioFileNames: audioFiles.map((f) => f.name),
        youtubeSource: selectedYoutube ?? undefined,
        songsterrSource: songsterrSong
          ? {
              songId: songsterrSong.songId,
              revisionId: songsterrSong.revisionId,
              trackIndex: songsterrTrack?.index,
              trackName: songsterrTrack?.name,
              title: songsterrSong.title,
              artist: songsterrSong.artist,
              tuning: songsterrTrack?.tuning,
              url: songsterrSong.url,
            }
          : undefined,
      };

      let savedSong = song;
      try {
        const persisted = await uploadSongToAccount({
          song,
          tabFile,
          audioFile: audioFiles[0],
        });
        if (persisted) {
          savedSong = { ...persisted, tabData };
          addImportedSong(savedSong);
          dispatchSupabaseSongsChanged();
        } else {
          try {
            addImportedSong(song);
          } catch (err) {
            if (isQuotaExceededError(err)) {
              setBusy(false);
              setError(
                "Local song storage is full. Sign in to save songs to your account, or remove older local-only imports.",
              );
              return;
            }
            throw err;
          }
        }
      } catch (err) {
        console.error("[ImportSongDialog] Supabase upload failed", err);
        setError(accountSyncErrorMessage(err));
        setBusy(false);
        return;
      }

      if (tabPartIds.length && songsterrTrackIndex !== null) {
        const gpIndex = tabPartIds.indexOf(songsterrTrackIndex);
        if (gpIndex >= 0) setPreferredTrackIndex(savedSong.id, gpIndex);
      }

      // Deliberately not awaited: DTW takes tens of seconds to minutes. The
      // player opens behind an alignment overlay and becomes playable when the
      // job writes the real mapping.
      void queueAlignment({
        songId: savedSong.id,
        gpBytes: tabBytes,
        audioBlob: audioFiles[0],
        audioDurationSec:
          durationSec || selectedYoutube?.durationSec || undefined,
      });

      setStage("success");
      await wait(520);
      setOpen(false);
      reset();
      router.push(`/player/${savedSong.id}`);
    } catch (err) {
      setBusy(false);
      setStage("compose");
      setError(
        isQuotaExceededError(err)
          ? "That tab file is too large to store locally."
          : "Could not import that song. Check the file and try again.",
      );
    }
  }

  /** Resolve a Songsterr link/id to its current revision and pick a track. */
  async function resolveSongsterr(input: string) {
    const response = await fetch(
      `/api/songsterr/song?url=${encodeURIComponent(input)}`,
    );
    const body = (await response.json()) as {
      song?: SongsterrSong;
      suggestedTrack?: SongsterrTrack | null;
      error?: string;
    };
    if (!response.ok || !body.song) {
      throw new Error(body.error ?? "Songsterr lookup failed.");
    }

    setSongsterrSong(body.song);
    setSongsterrTrackIndex(body.suggestedTrack?.index ?? null);

    // Songsterr's artist/title is a far better YouTube query than the raw
    // input, so the audio half of the import can run straight off it.
    const query = `${body.song.artist} ${body.song.title}`;
    setYoutubeQuery(query);
    void runYoutubeSearch(query);
    void downloadSongsterrTab(body.song);
  }

  async function downloadSongsterrTab(song: SongsterrSong) {
    songsterrDownloadIdRef.current = song.songId;
    setTabDownloading(true);
    setTabError(null);
    setTabFiles([]);
    setTabPartIds([]);

    try {
      const response = await fetch("/api/songsterr/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: song.songId }),
      });

      if (songsterrDownloadIdRef.current !== song.songId) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Download failed with ${response.status}.`);
      }

      const blob = await response.blob();
      if (songsterrDownloadIdRef.current !== song.songId) return;
      if (blob.size < 100) {
        throw new Error("Songsterr returned an empty tab file.");
      }

      const fileName =
        fileNameFromContentDisposition(
          response.headers.get("Content-Disposition"),
        ) ?? `${song.artist} ${song.title}.gp`;
      setTabFiles([
        new File([blob], fileName, {
          type: blob.type || "application/gp",
        }),
      ]);
      setTabPartIds(parsePartIds(response.headers.get("X-Songsterr-Part-Ids")));
    } catch (err) {
      if (songsterrDownloadIdRef.current !== song.songId) return;
      setTabError(
        err instanceof Error ? err.message : "Songsterr tab download failed.",
      );
    } finally {
      if (songsterrDownloadIdRef.current === song.songId) {
        setTabDownloading(false);
      }
    }
  }

  async function handleSongsterrLookup() {
    const q = songsterrQuery.trim();
    if (!q || songsterrLoading) return;
    setSongsterrLoading(true);
    setSongsterrError(null);

    try {
      if (looksLikeSongsterrLink(q)) {
        setSongsterrResults([]);
        await resolveSongsterr(q);
        return;
      }

      const response = await fetch(
        `/api/songsterr/search?q=${encodeURIComponent(q)}`,
      );
      const body = (await response.json()) as {
        results?: SongsterrSong[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Songsterr search failed.");

      setSongsterrSong(null);
      setSongsterrTrackIndex(null);
      setSongsterrResults(body.results ?? []);
      if (!body.results?.length) {
        setSongsterrError("No Songsterr results found.");
      }
    } catch (err) {
      setSongsterrResults([]);
      setSongsterrError(
        err instanceof Error ? err.message : "Songsterr lookup failed.",
      );
    } finally {
      setSongsterrLoading(false);
    }
  }

  async function handleSongsterrPick(song: SongsterrSong) {
    if (songsterrLoading) return;
    setSongsterrLoading(true);
    setSongsterrError(null);
    try {
      await resolveSongsterr(String(song.songId));
      setSongsterrResults([]);
    } catch (err) {
      setSongsterrError(
        err instanceof Error ? err.message : "Songsterr lookup failed.",
      );
    } finally {
      setSongsterrLoading(false);
    }
  }

  async function handleYoutubeSearch() {
    await runYoutubeSearch(youtubeQuery);
  }

  async function runYoutubeSearch(query: string) {
    const q = query.trim();
    if (!q) return;
    setYoutubeSearching(true);
    setYoutubeError(null);
    setSelectedYoutube(null);

    try {
      const response = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(q)}`,
      );
      const body = (await response.json()) as {
        results?: YouTubeSearchResult[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "YouTube search failed.");
      }
      setYoutubeResults(body.results ?? []);
      if (!body.results?.length) {
        setYoutubeError("No YouTube results found.");
      }
    } catch (err) {
      setYoutubeResults([]);
      setYoutubeError(
        err instanceof Error ? err.message : "YouTube search failed.",
      );
    } finally {
      setYoutubeSearching(false);
    }
  }

  async function handleYoutubeSelect(result: YouTubeSearchResult) {
    if (youtubeDownloadingId) return;
    setSelectedYoutube(result);
    setYoutubeError(null);
    setYoutubeDownloadingId(result.videoId);
    setAudioFiles([]);

    try {
      const response = await fetch("/api/youtube/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: result.videoId }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          details?: string;
        } | null;
        throw new Error(body?.error ?? `Download failed with ${response.status}.`);
      }

      const blob = await response.blob();
      const fileName =
        fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
        `${result.videoId}.m4a`;
      setAudioFiles([
        new File([blob], fileName, {
          type: blob.type || response.headers.get("Content-Type") || "audio/mp4",
        }),
      ]);
    } catch (err) {
      setYoutubeError(
        err instanceof Error ? err.message : "YouTube audio download failed.",
      );
    } finally {
      setYoutubeDownloadingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && stage !== "compose") return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <MotionButton whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
          <FileMusic className="h-4 w-4" />
          Import song
        </MotionButton>
      </DialogTrigger>

      <AnimatePresence>
        {open && (
          <DialogPortal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/60"
                variants={overlayVariants}
                initial="hidden"
                animate="show"
                exit="hidden"
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                layout
                className="fixed left-1/2 top-1/2 z-50 grid max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-sm border border-rule-strong bg-paper-raised p-8 focus:outline-none"
                variants={modalVariants}
                initial="hidden"
                animate="show"
                exit="hidden"
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {stage === "compose" && (
                  <DialogPrimitive.Close
                    className="absolute right-5 top-5 rounded-sm p-1 text-ink-faint transition-colors hover:text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </DialogPrimitive.Close>
                )}

                <AnimatePresence mode="wait">
                  {stage === "generating" ? (
                    <GeneratingState />
                  ) : stage === "success" ? (
                    <SuccessState />
                  ) : (
                    <motion.div
                      key="compose"
                      layout
                      className="grid gap-5"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      <DialogHeader>
                        <DialogTitle>Add a new song</DialogTitle>
                      </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <DropZone
            title="Drop tab file"
            hint="Guitar Pro 1-8, PowerTab"
            icon={<FileMusic className="h-6 w-6" />}
            accept={TAB_EXTENSIONS.join(",")}
            allowed={TAB_EXTENSIONS}
            files={tabFiles}
            onFiles={(files) => {
              songsterrDownloadIdRef.current = null;
              setTabDownloading(false);
              setTabError(null);
              setTabPartIds([]);
              setTabFiles(files);
            }}
            busy={tabDownloading}
            needed={
              tabFiles.length === 0 &&
              !tabDownloading &&
              (audioFiles.length > 0 || Boolean(songsterrSong))
            }
          />
          <DropZone
            title="Drop audio file(s)"
            hint="mp3, m4a, flac, wav"
            icon={<AudioLines className="h-6 w-6" />}
            accept={AUDIO_EXTENSIONS.join(",")}
            allowed={AUDIO_EXTENSIONS}
            multiple
            files={audioFiles}
            onFiles={setAudioFiles}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-sm border border-rule bg-paper-raised p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Guitar className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="truncate text-sm font-medium text-zinc-200">
                Search Songsterr
              </p>
            </div>
            {songsterrSong && (
              <a
                href={songsterrSong.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:text-accent-muted"
              >
                Open
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={songsterrQuery}
                onChange={(e) => setSongsterrQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSongsterrLookup();
                }}
                placeholder="Paste a Songsterr link, or search song / artist"
                className="pl-9"
              />
            </div>
            <MotionButton
              type="button"
              variant="outline"
              onClick={() => void handleSongsterrLookup()}
              disabled={songsterrLoading || !songsterrQuery.trim()}
              whileHover={
                songsterrLoading || !songsterrQuery.trim()
                  ? undefined
                  : { scale: 1.02 }
              }
              whileTap={
                songsterrLoading || !songsterrQuery.trim()
                  ? undefined
                  : { scale: 0.98 }
              }
            >
              {songsterrLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Look up
            </MotionButton>
          </div>

          {songsterrError && (
            <p className="text-sm text-accent" role="alert">
              {songsterrError}
            </p>
          )}

          <AnimatePresence mode="wait">
            {songsterrLoading && songsterrResults.length === 0 && (
              <motion.div
                key="songsterr-loading"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                <SearchSkeletonRows />
              </motion.div>
            )}
          </AnimatePresence>

          {songsterrResults.length > 0 && (
            <motion.div
              className="max-h-56 space-y-2 overflow-y-auto pr-1"
              variants={listVariants}
              initial="hidden"
              animate="show"
            >
              {songsterrResults.map((result) => {
                const bass = result.tracks.find((t) => t.family === "bass");
                return (
                  <motion.button
                    key={result.songId}
                    type="button"
                    onClick={() => void handleSongsterrPick(result)}
                    variants={rowVariants}
                    whileHover={{ scale: 1.01, borderColor: "rgb(var(--accent))" }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="w-full rounded-sm border border-rule bg-paper p-2 text-left transition-colors hover:border-accent"
                  >
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {result.title}
                    </p>
                    <p className="truncate text-xs text-zinc-400">
                      {result.artist}
                      {bass ? ` · bass ${tuningLabel(bass.tuning) ?? ""}` : ""}
                    </p>
                  </motion.button>
                );
              })}
            </motion.div>
          )}

          {songsterrSong && (
            <div className="flex flex-col gap-2 rounded-sm border border-rule bg-paper p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {songsterrSong.title}
                </p>
                <p className="truncate text-xs text-zinc-400">
                  {songsterrSong.artist}
                  {songsterrSong.revisionId
                    ? ` · revision ${songsterrSong.revisionId}`
                    : ""}
                </p>
              </div>

              {songsterrSong.tracks.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Track
                  <Select
                    className="h-9 w-full"
                    value={songsterrTrackIndex ?? ""}
                    onChange={(e) =>
                      setSongsterrTrackIndex(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  >
                    {songsterrSong.tracks.map((track) => (
                      <option key={track.index} value={track.index}>
                        {track.name === track.instrument
                          ? track.name
                          : `${track.name} · ${track.instrument}`}
                      </option>
                    ))}
                  </Select>
                </label>
              )}

              {songsterrTrack && (
                <p className="text-xs text-zinc-400">
                  {tuningLabel(songsterrTrack.tuning) ?? "No tuning"}
                  {songsterrTrack.difficulty
                    ? ` · difficulty ${songsterrTrack.difficulty}/5`
                    : ""}
                </p>
              )}

              {tabDownloading && (
                <p className="flex items-center gap-2 text-xs text-accent">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Downloading Guitar Pro tab…
                </p>
              )}

              {tabError && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-accent" role="alert">
                    {tabError}
                  </p>
                  <MotionButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void downloadSongsterrTab(songsterrSong)}
                    disabled={tabDownloading}
                    whileHover={tabDownloading ? undefined : { scale: 1.02 }}
                    whileTap={tabDownloading ? undefined : { scale: 0.98 }}
                  >
                    Retry download
                  </MotionButton>
                </div>
              )}

              {!tabDownloading && !tabError && tabPartIds.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Check className="h-3.5 w-3.5 text-accent" />
                  Tab downloaded. You can still drop a different Guitar Pro file
                  above.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-sm border border-rule bg-paper-raised p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Youtube className="h-4 w-4 shrink-0 text-accent" />
              <p className="truncate text-sm font-medium text-zinc-200">
                Search YouTube
              </p>
            </div>
            {selectedYoutube && (
              <a
                href={selectedYoutube.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:text-accent-muted"
              >
                Open
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={youtubeQuery}
                onChange={(e) => setYoutubeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleYoutubeSearch();
                }}
                placeholder="Song or artist"
                className="pl-9"
              />
            </div>
            <MotionButton
              type="button"
              variant="outline"
              onClick={() => void handleYoutubeSearch()}
              disabled={youtubeSearching || !youtubeQuery.trim()}
              whileHover={
                youtubeSearching || !youtubeQuery.trim()
                  ? undefined
                  : { scale: 1.02 }
              }
              whileTap={
                youtubeSearching || !youtubeQuery.trim()
                  ? undefined
                  : { scale: 0.98 }
              }
            >
              {youtubeSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </MotionButton>
          </div>

          {youtubeError && (
            <p className="text-sm text-accent" role="alert">
              {youtubeError}
            </p>
          )}

          <AnimatePresence mode="wait">
            {youtubeSearching && youtubeResults.length === 0 && (
              <motion.div
                key="youtube-loading"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                <SearchSkeletonRows />
              </motion.div>
            )}
          </AnimatePresence>

          {youtubeResults.length > 0 && (
            <motion.div
              className="max-h-64 space-y-2 overflow-y-auto pr-1"
              variants={listVariants}
              initial="hidden"
              animate="show"
            >
              {youtubeResults.map((result) => {
                const selected = selectedYoutube?.videoId === result.videoId;
                return (
                  <motion.button
                    key={result.videoId}
                    type="button"
                    onClick={() => void handleYoutubeSelect(result)}
                    layoutId={`import-youtube-${result.videoId}`}
                    variants={rowVariants}
                    animate={{
                      scale: selected ? 1.015 : 1,
                      borderColor: selected
                        ? "rgb(var(--accent) / 0.6)"
                        : "rgb(var(--rule))",
                    }}
                    whileHover={{ scale: selected ? 1.015 : 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className={cn(
                      "grid w-full grid-cols-[72px_minmax(0,1fr)_24px] items-center gap-3 rounded-sm border border-rule bg-paper p-2 text-left transition-colors hover:border-accent",
                      selected && "border-accent/60 bg-accent/10",
                    )}
                  >
                    <div className="h-10 overflow-hidden rounded bg-black/30">
                      {result.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={result.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Youtube className="h-4 w-4 text-zinc-500" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {decodeHtmlEntities(result.title)}
                      </p>
                      <p className="truncate text-xs text-zinc-400">
                        {decodeHtmlEntities(result.channelTitle)}
                        {result.durationSec
                          ? ` · ${formatDuration(result.durationSec)}`
                          : ""}
                        {formatPublishedDate(result.publishedAt)
                          ? ` · ${formatPublishedDate(result.publishedAt)}`
                          : ""}
                      </p>
                    </div>
                    {youtubeDownloadingId === result.videoId ? (
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    ) : (
                      selected && <Check className="h-4 w-4 text-accent" />
                    )}
                  </motion.button>
                );
              })}
            </motion.div>
          )}

          {selectedYoutube && !audioFiles.length && (
            <p className="text-xs leading-5 text-zinc-400">
              {youtubeDownloadingId
                ? "Downloading audio for playback and sync..."
                : "Audio could not be downloaded. Add a local audio file or choose a different result."}
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-accent" role="alert">
            {error}
          </p>
        )}

        {!ready && (
          <p className="text-xs text-zinc-400">
            Still needed: {missing.join(" and ")}.
          </p>
        )}

                      <DialogFooter>
                        <DialogClose asChild>
                          <MotionButton
                            variant="ghost"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                          >
                            Cancel
                          </MotionButton>
                        </DialogClose>
                        <MotionButton
                          onClick={handleFinish}
                          disabled={!ready || busy}
                          whileHover={!ready || busy ? undefined : { scale: 1.02 }}
                          whileTap={!ready || busy ? undefined : { scale: 0.98 }}
                        >
                          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                          Finish
                        </MotionButton>
                      </DialogFooter>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPortal>
        )}
      </AnimatePresence>
    </Dialog>
  );
}
