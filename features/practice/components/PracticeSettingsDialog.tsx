"use client";

import { useEffect, useState } from "react";
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
import { cn } from "@/lib/cn";
import {
  keyLabel,
  normalizeBindingKey,
  sanitizePracticeSettings,
  type LaneKeys,
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
  /** Which binding slot is waiting for a keypress, if any. */
  const [listening, setListening] = useState<{ lane: number; alt: boolean } | null>(null);

  useEffect(() => {
    if (!open) setListening(null);
  }, [open]);

  function bindKey(lane: number, alt: boolean, key: string | null) {
    const keys = [...draft.keys] as LaneKeys;
    const altKeys = [...draft.altKeys] as LaneKeys;
    if (key) {
      // A key can only drive one lane — unbind it wherever else it was set.
      for (let i = 0; i < 4; i++) {
        if (altKeys[i] === key) altKeys[i] = "";
        if (keys[i] === key && i !== lane) {
          keys[i] = altKeys[i] || keys[i];
          altKeys[i] = "";
        }
      }
    }
    if (alt) {
      altKeys[lane] = key ?? "";
    } else if (key) {
      keys[lane] = key;
    }
    setDraft({ ...draft, keys, altKeys });
  }

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
                <div key={lane.lane} className="flex flex-col items-center gap-1">
                  <span className={`font-mono text-[9.5px] uppercase tracking-label ${lane.text}`}>
                    {lane.name}
                  </span>
                  <KeyBinder
                    value={draft.keys[lane.lane]}
                    listening={listening?.lane === lane.lane && !listening.alt}
                    onListen={() => setListening({ lane: lane.lane, alt: false })}
                    onBind={(key) => {
                      bindKey(lane.lane, false, key);
                      setListening(null);
                    }}
                    onCancel={() => setListening(null)}
                  />
                  <KeyBinder
                    value={draft.altKeys[lane.lane]}
                    clearable
                    listening={listening?.lane === lane.lane && listening.alt}
                    onListen={() => setListening({ lane: lane.lane, alt: true })}
                    onBind={(key) => {
                      bindKey(lane.lane, true, key);
                      setListening(null);
                    }}
                    onCancel={() => setListening(null)}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 font-mono text-[10px] text-ink-faint">
              Click a box, then press a key. Second row is optional; Backspace clears it.
            </p>
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

/**
 * One binding slot. Click to arm it, then the next keypress is captured
 * (`KeyboardEvent.key`, so ; Space and arrows all work). Escape cancels;
 * Backspace clears when `clearable`.
 */
function KeyBinder({
  value,
  clearable = false,
  listening,
  onListen,
  onBind,
  onCancel,
}: {
  value: string;
  clearable?: boolean;
  listening: boolean;
  onListen: () => void;
  onBind: (key: string | null) => void;
  onCancel: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onListen}
      onBlur={() => listening && onCancel()}
      onKeyDown={(e) => {
        if (!listening) return;
        // Keep the keypress from reaching the dialog (Escape closes it) and
        // from activating the button (Space/Enter).
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") return onCancel();
        if (clearable && (e.key === "Backspace" || e.key === "Delete")) return onBind(null);
        const key = normalizeBindingKey(e.key);
        if (key) onBind(key);
      }}
      className={cn(
        "h-9 w-full rounded-sm border bg-paper text-center font-mono text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        listening ? "border-accent animate-pulse" : "border-ink",
        !value && !listening && "border-dashed text-ink-faint",
      )}
    >
      {listening ? "…" : keyLabel(value) || "—"}
    </button>
  );
}

export { type PracticeSettings };
