import type { GradeSummary } from "../types/playback";

/**
 * Yousician-style scoring readout, set as one bordered strip with a vertical
 * spine rather than four boxes. Values are mocked until note detection exists.
 */
export function FeedbackPanel({ grade }: { grade: GradeSummary }) {
  return (
    <div className="flex items-stretch rounded-sm border border-rule-strong bg-paper-raised">
      <h2 className="grid place-items-center border-r border-rule-strong px-3 font-mono text-[9.5px] uppercase tracking-label text-ink-muted [writing-mode:vertical-rl] [transform:rotate(180deg)]">
        Last attempt
      </h2>
      <div className="grid flex-1 grid-cols-2 sm:grid-cols-4">
        <Stat label="Accuracy" first>
          <span className="text-accent">{grade.accuracy}%</span>
        </Stat>
        <Stat label="Notes hit">
          {grade.notesHit}
          <span className="text-ink-ghost">/{grade.notesTotal}</span>
        </Stat>
        <Stat label="Best streak">{grade.bestStreak}</Stat>
        <Stat label="Timing">
          <span className="text-ink-ghost">—</span>
        </Stat>
      </div>
    </div>
  );
}

/** Cells are divided by a hairline, with no fill and no radius of their own. */
function Stat({
  label,
  children,
  first,
}: {
  label: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-[7px] px-4 py-3.5 ${
        first ? "" : "border-l border-rule"
      }`}
    >
      <span className="font-display text-[32px] font-bold leading-none text-ink">
        {children}
      </span>
      <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
        {label}
      </span>
    </div>
  );
}
