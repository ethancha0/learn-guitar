"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AudioLines,
  Check,
  ExternalLink,
  FileMusic,
  Loader2,
  Search,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { addImportedSong, type ImportedSong } from "../data/songStore";
import {
  uploadSongToAccount,
  dispatchSupabaseSongsChanged,
} from "../data/supabaseSongStore";
import { bytesToBase64 } from "../data/tabFile";
import { putBackingAudio } from "@/features/player/data/audioStore";
import { queueAlignment } from "@/features/player/data/alignmentQueue";
import type { YouTubeSearchResult } from "@/lib/youtube/types";
import { formatDuration } from "./formatDuration";

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
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 px-6 py-8 text-center transition-colors",
        dragging && "border-accent/70 bg-accent/5",
        files.length && "border-accent/40",
      )}
    >
      <div className="text-zinc-400">{icon}</div>
      <p className="text-base font-medium text-zinc-200">{title}</p>
      <p className="text-xs text-zinc-500">{hint}</p>

      {files.length > 0 && (
        <ul className="mt-1 w-full space-y-0.5 text-xs text-accent">
          {files.map((f) => (
            <li key={f.name} className="truncate">
              {f.name}
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => inputRef.current?.click()}
      >
        Browse…
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => accept_(e.target.files)}
      />
    </div>
  );
}

export function ImportSongDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = tabFiles.length > 0 && audioFiles.length > 0;

  function reset() {
    setTabFiles([]);
    setAudioFiles([]);
    setYoutubeQuery("");
    setYoutubeResults([]);
    setSelectedYoutube(null);
    setYoutubeSearching(false);
    setYoutubeDownloadingId(null);
    setYoutubeError(null);
    setBusy(false);
    setError(null);
  }

  async function handleFinish() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    try {
      const tabFile = tabFiles[0];
      const [durationSec, tabBytes] = await Promise.all([
        readAudioDuration(audioFiles[0]),
        tabFile.arrayBuffer().then((buf) => new Uint8Array(buf)),
      ]);
      const tabData = bytesToBase64(tabBytes);
      const title =
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
        artist: selectedYoutube
          ? decodeHtmlEntities(selectedYoutube.channelTitle)
          : "Imported",
        durationSec: durationSec || selectedYoutube?.durationSec || 0,
        bpm: 120,
        difficulty: "intermediate",
        hasAudio: true,
        hasTab: true,
        tabData,
        createdAt: Date.now(),
        tabFileName: tabFile.name,
        audioFileNames: audioFiles.map((f) => f.name),
        youtubeSource: selectedYoutube ?? undefined,
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

      setOpen(false);
      reset();
      router.push(`/player/${savedSong.id}`);
    } catch (err) {
      setBusy(false);
      setError(
        isQuotaExceededError(err)
          ? "That tab file is too large to store locally."
          : "Could not import that song. Check the file and try again.",
      );
    }
  }

  async function handleYoutubeSearch() {
    const q = youtubeQuery.trim();
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
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <FileMusic className="h-4 w-4" />
          Import song
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
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
            onFiles={setTabFiles}
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

        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-surface-overlay/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Youtube className="h-4 w-4 shrink-0 text-red-400" />
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
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleYoutubeSearch()}
              disabled={youtubeSearching || !youtubeQuery.trim()}
            >
              {youtubeSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </Button>
          </div>

          {youtubeError && (
            <p className="text-sm text-red-400" role="alert">
              {youtubeError}
            </p>
          )}

          {youtubeResults.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {youtubeResults.map((result) => {
                const selected = selectedYoutube?.videoId === result.videoId;
                return (
                  <button
                    key={result.videoId}
                    type="button"
                    onClick={() => void handleYoutubeSelect(result)}
                    className={cn(
                      "grid w-full grid-cols-[72px_minmax(0,1fr)_24px] items-center gap-3 rounded-md border border-white/10 bg-surface-raised/70 p-2 text-left transition-colors hover:border-accent/40",
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
                  </button>
                );
              })}
            </div>
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
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleFinish} disabled={!ready || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Finish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
