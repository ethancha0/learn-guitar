import { Music4 } from "lucide-react";

/**
 * Placeholder for the synced tab/score surface. alphaTab renders here later
 * (it needs the DOM, so the real version will be a client component).
 */
export function ScoreView() {
  return (
    <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-white/5 bg-surface-raised text-zinc-500">
      <Music4 className="h-8 w-8" />
      <p className="text-sm">Tab / score renders here</p>
      <p className="text-xs">alphaTab integration pending</p>
    </div>
  );
}
