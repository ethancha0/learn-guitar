"use client";

import { useState } from "react";
import { Music4, Settings } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
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
import { LANE_COLORS } from "../data/laneColors";
import {
  sanitizePracticeSettings,
  type PracticeSettings,
} from "../data/practiceSettings";

const NOTE_SPEED_OPTIONS: { value: number; label: string }[] = [
  { value: 2.2, label: "Slower" },
  { value: 1.6, label: "Normal" },
  { value: 1.1, label: "Fast" },
  { value: 0.8, label: "Fastest" },
];

const HIT_WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 0.15, label: "Tight" },
  { value: 0.2, label: "Normal" },
  { value: 0.26, label: "Loose" },
];

/**
 * Key mapping + note speed + hit window + fret numbers, in one dialog behind
 * both the Music4 (key mapping) and Settings icon keys on the masthead.
 */
export function PracticeSettingsDialog({
  settings,
  onChange,
  icon = "settings",
}: {
  settings: PracticeSettings;
  onChange: (next: PracticeSettings) => void;
  icon?: "settings" | "keys";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(settings);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={icon === "keys" ? "Key mapping" : "Practice settings"}
        >
          {icon === "keys" ? (
            <Music4 className="h-4 w-4" />
          ) : (
            <Settings className="h-4 w-4" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Practice settings</DialogTitle>
          <DialogDescription>Key map, note speed, timing window.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
              Key map
            </p>
            <div className="grid grid-cols-4 gap-2">
              {LANE_COLORS.map((lane) => (
                <label key={lane.lane} className="flex flex-col items-center gap-1">
                  <span className={`font-mono text-[9.5px] uppercase tracking-label ${lane.text}`}>
                    {lane.name}
                  </span>
                  <input
                    value={draft.keys[lane.lane].toUpperCase()}
                    onChange={(e) => {
                      const value = e.target.value.slice(-1) || draft.keys[lane.lane];
                      const keys = [...draft.keys] as [string, string, string, string];
                      keys[lane.lane] = value.toLowerCase();
                      setDraft({ ...draft, keys });
                    }}
                    maxLength={1}
                    className="h-9 w-full rounded-sm border border-ink bg-paper text-center font-mono text-sm uppercase text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 font-mono text-xs text-ink-muted">
            Note speed
            <Select
              value={draft.noteSpeedSec}
              onChange={(e) => setDraft({ ...draft, noteSpeedSec: Number(e.target.value) })}
            >
              {NOTE_SPEED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex items-center justify-between gap-3 font-mono text-xs text-ink-muted">
            Timing window
            <Select
              value={draft.hitWindowSec}
              onChange={(e) => setDraft({ ...draft, hitWindowSec: Number(e.target.value) })}
            >
              {HIT_WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex items-center justify-between gap-3 font-mono text-xs text-ink-muted">
            Fret numbers
            <input
              type="checkbox"
              checked={draft.showFretNumbers}
              onChange={(e) => setDraft({ ...draft, showFretNumbers: e.target.checked })}
              className="h-4 w-4 accent-ink"
            />
          </label>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              onClick={() => onChange(sanitizePracticeSettings(draft))}
            >
              Save
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { type PracticeSettings };
