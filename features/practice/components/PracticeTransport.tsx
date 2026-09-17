import { Play, Pause, SkipBack } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { formatDuration } from "@/features/library/components/formatDuration";

const SPEEDS = [0.5, 0.75, 1, 1.25];

/**
 * The practice route's transport: same shell as `TransportBar`, trimmed to
 * the controls that matter mid-run — restart, play/pause, position, speed.
 */
export function PracticeTransport({
  playing,
  positionSec,
  durationSec,
  speed,
  onTogglePlay,
  onRestart,
  onSpeedChange,
}: {
  playing: boolean;
  positionSec: number;
  durationSec: number;
  speed: number;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSpeedChange: (speed: number) => void;
}) {
  return (
    <div className="flex items-center gap-4 border border-rule-strong bg-paper-raised px-4 py-2.5">
      <Button variant="ghost" size="icon" aria-label="Restart" onClick={onRestart}>
        <SkipBack className="h-4 w-4" />
      </Button>

      <Button
        size="icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onTogglePlay}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="flex flex-1 items-center gap-3 font-mono text-xs text-ink-muted">
        <span className="tabular-nums">{formatDuration(Math.max(0, positionSec))}</span>
        <div className="h-0.5 flex-1 overflow-hidden bg-track">
          <div
            className="h-full bg-accent"
            style={{
              width: `${durationSec > 0 ? Math.min(100, Math.max(0, (positionSec / durationSec) * 100)) : 0}%`,
            }}
          />
        </div>
        <span className="tabular-nums">{formatDuration(durationSec)}</span>
      </div>

      <label className="flex items-center gap-1 font-mono text-xs text-ink-muted">
        <span className="hidden sm:inline">Speed</span>
        <Select value={speed} onChange={(e) => onSpeedChange(Number(e.target.value))}>
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}x
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
