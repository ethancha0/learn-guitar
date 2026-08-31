"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileMusic, AudioLines, Search, Loader2 } from "lucide-react";
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
const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".flac", ".wav"];

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
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = tabFiles.length > 0 && audioFiles.length > 0;

  function reset() {
    setTabFiles([]);
    setAudioFiles([]);
    setSearch("");
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
      const title = titleFromFileName(tabFile.name) || "Imported song";
      const id = `${slugify(title)}-${Date.now().toString(36)}`;

      // Audio can be several MB, so it goes to IndexedDB rather than localStorage.
      await putBackingAudio(id, audioFiles[0]);

      const song: ImportedSong = {
        id,
        title,
        artist: "Imported",
        durationSec,
        bpm: 120,
        difficulty: "intermediate",
        hasAudio: true,
        hasTab: true,
        tabData,
        createdAt: Date.now(),
        tabFileName: tabFile.name,
        audioFileNames: audioFiles.map((f) => f.name),
      };

      addImportedSong(song);

      // Deliberately not awaited: DTW takes tens of seconds to minutes. The
      // player opens behind an alignment overlay and becomes playable when the
      // job writes the real mapping.
      void queueAlignment({
        songId: id,
        gpBytes: tabBytes,
        audioBlob: audioFiles[0],
        audioDurationSec: durationSec || undefined,
      });

      try {
        const persisted = await uploadSongToAccount({
          song,
          tabFile,
          audioFile: audioFiles[0],
        });
        if (persisted) {
          addImportedSong({ ...persisted, tabData });
          dispatchSupabaseSongsChanged();
        }
      } catch (err) {
        console.error("[ImportSongDialog] Supabase upload failed", err);
        setError(
          "Saved on this device, but account sync failed. Check your Supabase setup and try signing in again.",
        );
        setBusy(false);
        return;
      }

      setOpen(false);
      reset();
      router.push(`/player/${id}`);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error && err.name === "QuotaExceededError"
          ? "That tab file is too large to store locally."
          : "Could not import that song. Check the file and try again.",
      );
    }
  }

  function handleSearch() {
    const q = search.trim();
    if (!q) return;
    window.open(
      `https://www.songsterr.com/?pattern=${encodeURIComponent(q)}`,
      "_blank",
      "noopener,noreferrer",
    );
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

      <DialogContent>
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

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-zinc-200">
            Can&apos;t find a song on your computer?
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="Search tabs online…"
              className="pl-9"
            />
          </div>
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
