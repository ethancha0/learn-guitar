import { cn } from "@/lib/cn";

/**
 * The HUD strip above the highway: Score / Combo / Accuracy / Condition /
 * Bar, in the same bordered-strip vocabulary as `FeedbackPanel`.
 */
export function PracticeHud({
  score,
  combo,
  accuracy,
  condition,
  bar,
  totalBars,
}: {
  score: number;
  combo: number;
  accuracy: number;
  condition: number;
  bar: number;
  totalBars: number;
}) {
  return (
    <div className="flex items-stretch border border-rule bg-paper-raised">
      <HudCell label="Score" minWidthPx={190}>
        <span className="tabular-nums">{Math.round(score).toLocaleString()}</span>
      </HudCell>
      <HudCell label="Combo" minWidthPx={150}>
        <span className="text-accent">{combo}</span>
        <span className="text-[19px] text-ink-ghost">×</span>
      </HudCell>
      <HudCell label="Accuracy" minWidthPx={150}>
        {Math.round(accuracy)}
        <span className="text-[19px] text-ink-ghost">%</span>
      </HudCell>

      <div className="flex flex-1 flex-col justify-center gap-1.5 border-r border-rule px-5 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
            Condition
          </span>
          <span className="font-display text-[15px] text-ink">
            {Math.round(condition)}
          </span>
        </div>
        <div className="h-1 bg-track">
          <div
            className={cn(
              "h-full",
              condition <= 40 ? "bg-accent" : "bg-ink",
            )}
            style={{ width: `${condition}%`, transition: "width 120ms linear" }}
          />
        </div>
        <div className="flex justify-between font-mono text-[9.5px] tracking-button text-ink-muted">
          <span>Miss · −7</span>
          <span>Hit · +2</span>
        </div>
      </div>

      <HudCell label="Bar" minWidthPx={170} align="right" last>
        {bar}
        <span className="text-ink-ghost">/{totalBars}</span>
      </HudCell>
    </div>
  );
}

function HudCell({
  label,
  minWidthPx,
  align = "left",
  last,
  children,
}: {
  label: string;
  minWidthPx: number;
  align?: "left" | "right";
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-5 py-3",
        !last && "border-r border-rule",
        align === "right" && "items-end text-right",
      )}
      style={{ minWidth: minWidthPx }}
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
