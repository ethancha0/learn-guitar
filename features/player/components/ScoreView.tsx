import { Music4 } from "lucide-react";

/**
 * Placeholder for the synced tab/score surface. alphaTab renders here later
 * (it needs the DOM, so the real version will be a client component).
 */
export function ScoreView() {
  return (
    <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 rounded-sm border border-rule-strong bg-paper-sheet text-ink-faint shadow-sheet">
      <Music4 className="h-7 w-7" />
      <p className="font-display text-[15px] italic text-ink-muted">
        Tab / score renders here
      </p>
      <p className="font-mono text-[9.5px] uppercase tracking-label">
        alphaTab integration pending
      </p>
    </div>
  );
}
