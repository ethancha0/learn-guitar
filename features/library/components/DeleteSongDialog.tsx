"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { deleteSong } from "../data/deleteSong";
import type { Song } from "../types/song";

/**
 * The delete key on a catalogue row, plus the confirmation it opens. Removing a
 * song throws away the imported files, so it is never a single click — and the
 * key itself stays out of the way until the row is hovered or focused (on touch
 * there is no hover, so it is always drawn there).
 */
export function DeleteSongDialog({ song }: { song: Song }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteSong(song.id);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not delete this song: ${err.message}`
          : "Could not delete this song. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete ${song.title}`}
          className={cn(
            "absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-sm p-1.5 text-ink-faint",
            "transition-colors hover:bg-[var(--wash)] hover:text-accent",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            // Hover-revealed on the printed measure, always drawn on touch.
            "md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete this song?</DialogTitle>
          <DialogDescription>
            {song.title} — {song.artist}
          </DialogDescription>
        </DialogHeader>

        <p className="font-mono text-xs leading-relaxed text-ink-muted">
          The tab, the recording and this song&rsquo;s sync settings are removed
          from your account and this device. This cannot be undone.
        </p>

        {error && (
          <p className="font-mono text-xs text-accent" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="outline"
            onClick={handleDelete}
            disabled={busy}
            className="border-accent text-accent hover:bg-accent-wash"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
