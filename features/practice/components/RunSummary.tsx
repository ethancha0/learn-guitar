import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { JudgeCounts } from "../types/practice";

export interface RunSummaryData {
  songTitle: string;
  artist: string;
  bars: number;
  bpm: number;
  speed: number;
  runNumber: number;
  accuracy: number;
  isNewBest: boolean;
  notesHit: number;
  notesTotal: number;
  bestCombo: number;
  score: number;
  meanTimingMs: number;
  barsFailed: number;
  judgeCounts: JudgeCounts;
  weakestString: { name: string; accuracy: number } | null;
  /** Percent (0–100) per bar; empty bars (no notes) read 0. */
  perBarAccuracy: readonly number[];
  weakBarRange: { start: number; end: number } | null;
}

const BAR_CHART_HEIGHT = 120;
const BAR_MAX_HEIGHT = 92;

export function RunSummary({
  data,
  onBackToLibrary,
  onLoopBars,
  onRunAgain,
}: {
  data: RunSummaryData;
  onBackToLibrary: () => void;
  onLoopBars: (() => void) | null;
  onRunAgain: () => void;
}) {
  const { judgeCounts } = data;
  const lateEarly = judgeCounts.early + judgeCounts.late;
  const maxCount = Math.max(1, judgeCounts.perfect, judgeCounts.good, lateEarly, judgeCounts.miss);

  return (
    <div className="flex flex-col gap-[22px]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-rule-strong pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-faint">
            Rhythm practice · run {data.runNumber}
          </p>
          <h1 className="mt-1.5 font-display text-[38px] font-bold tracking-[-0.025em] text-ink">
            {data.songTitle}
          </h1>
          <p className="mt-1 font-display text-[15px] italic text-ink-muted">
            {data.artist} · {data.bars} bars at {data.bpm} bpm, {data.speed}x
          </p>
        </div>
        <div className="flex items-center gap-3.5">
          {data.isNewBest && (
            <span className="flex h-9 items-center rounded-sm border border-rule px-3.5 font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
              New best
            </span>
          )}
          <p className="font-display text-[64px] font-bold leading-[0.86] tracking-[-0.03em] text-accent">
            {Math.round(data.accuracy)}
            <span className="text-[26px] text-ink-ghost">%</span>
          </p>
        </div>
      </header>

      <div className="flex items-stretch border border-rule-strong bg-paper-raised">
        <h2 className="grid place-items-center border-r border-rule-strong px-3 font-mono text-[9.5px] uppercase tracking-label text-ink-muted [writing-mode:vertical-rl] [transform:rotate(180deg)]">
          This attempt
        </h2>
        <div className="grid flex-1 grid-cols-2 sm:grid-cols-5">
          <SummaryStat label="Notes hit" first>
            {data.notesHit}
            <span className="text-ink-ghost">/{data.notesTotal}</span>
          </SummaryStat>
          <SummaryStat label="Best streak">{data.bestCombo}</SummaryStat>
          <SummaryStat label="Score">{Math.round(data.score).toLocaleString()}</SummaryStat>
          <SummaryStat label="Mean timing">
            {data.meanTimingMs >= 0 ? "+" : ""}
            {Math.round(data.meanTimingMs)}
            <span className="text-[19px] text-ink-ghost">ms</span>
          </SummaryStat>
          <SummaryStat label="Bars failed">{data.barsFailed}</SummaryStat>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[22px] md:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 border border-rule bg-paper-raised p-4">
          <p className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
            Judgement
          </p>
          <JudgementRow label="Perfect" count={judgeCounts.perfect} max={maxCount} />
          <JudgementRow label="Good" count={judgeCounts.good} max={maxCount} />
          <JudgementRow label="Late / early" count={lateEarly} max={maxCount} />
          <JudgementRow label="Missed" count={judgeCounts.miss} max={maxCount} accent />
          {data.weakestString && (
            <div className="mt-1 border-t border-rule pt-3">
              <p className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
                Weakest string
              </p>
              <p className="mt-1 font-display text-[19px] font-semibold text-ink">
                {data.weakestString.name} string · {Math.round(data.weakestString.accuracy)}%
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border border-rule bg-paper-raised p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
              Accuracy by bar
            </p>
            {data.weakBarRange && (
              <p className="font-display text-[13px] italic text-ink-muted">
                bars {data.weakBarRange.start}–{data.weakBarRange.end} are the weak spot — loop
                them next
              </p>
            )}
          </div>
          <div className="flex items-end gap-1.5" style={{ height: BAR_CHART_HEIGHT }}>
            {data.perBarAccuracy.map((pct, i) => (
              <div
                key={i}
                className="flex flex-1 flex-col items-center justify-end gap-1"
                style={{ height: BAR_CHART_HEIGHT }}
              >
                <div
                  className={cn(
                    "w-full rounded-sm",
                    pct < 70 ? "bg-accent" : "bg-[rgba(237,234,225,0.75)]",
                  )}
                  style={{ height: `${Math.max(2, (Math.min(100, pct) / 100) * BAR_MAX_HEIGHT)}px` }}
                />
                {i % 2 === 0 && (
                  <span className="font-mono text-[9px] text-ink-ghost">{i + 1}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="outline" className="h-10" onClick={onBackToLibrary}>
          Back to library
        </Button>
        {onLoopBars && data.weakBarRange && (
          <Button
            variant="outline"
            className="h-10 border-accent text-accent hover:bg-accent-wash"
            onClick={onLoopBars}
          >
            Loop bars {data.weakBarRange.start}–{data.weakBarRange.end}
          </Button>
        )}
        <Button className="h-10" onClick={onRunAgain}>
          <Repeat className="h-4 w-4" />
          Run again
        </Button>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  children,
  first,
}: {
  label: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-[7px] px-4 py-3.5", !first && "border-l border-rule")}>
      <span className="font-display text-[32px] font-bold leading-none text-ink">{children}</span>
      <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
        {label}
      </span>
    </div>
  );
}

function JudgementRow({
  label,
  count,
  max,
  accent,
}: {
  label: string;
  count: number;
  max: number;
  accent?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (count / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className={accent ? "text-accent" : "text-ink"}>{label}</span>
        <span className="text-ink-muted">{count}</span>
      </div>
      <div className="h-[3px] bg-track">
        <div
          className={cn("h-full", accent ? "bg-accent" : "bg-ink")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
