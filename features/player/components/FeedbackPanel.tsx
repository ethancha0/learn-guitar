import type { GradeSummary } from "../types/playback";

const stat = "flex flex-col gap-0.5 rounded-md bg-surface-overlay px-3 py-2";

/** Yousician-style scoring readout. Values are mocked until note detection exists. */
export function FeedbackPanel({ grade }: { grade: GradeSummary }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-surface-raised p-4">
      <h2 className="text-sm font-medium text-zinc-200">Last attempt</h2>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className={stat}>
          <span className="text-lg font-semibold text-accent">{grade.accuracy}%</span>
          <span className="text-xs text-zinc-500">Accuracy</span>
        </div>
        <div className={stat}>
          <span className="text-lg font-semibold text-zinc-100">
            {grade.notesHit}/{grade.notesTotal}
          </span>
          <span className="text-xs text-zinc-500">Notes hit</span>
        </div>
        <div className={stat}>
          <span className="text-lg font-semibold text-zinc-100">{grade.bestStreak}</span>
          <span className="text-xs text-zinc-500">Best streak</span>
        </div>
        <div className={stat}>
          <span className="text-lg font-semibold text-zinc-100">—</span>
          <span className="text-xs text-zinc-500">Timing</span>
        </div>
      </div>
    </div>
  );
}
