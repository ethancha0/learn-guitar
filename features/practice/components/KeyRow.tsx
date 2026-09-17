import { cn } from "@/lib/cn";
import { LANE_COLORS, oklchColor } from "../data/laneColors";
import type { Lane } from "../types/practice";

/**
 * The four keycaps under the highway, centered on their lane. A 900px row
 * centered under the 1240px highway, each cap 150px wide so its center lands
 * on the lane center above it.
 */
export function KeyRow({
  keys,
  pressed,
}: {
  keys: readonly [string, string, string, string];
  pressed: readonly [boolean, boolean, boolean, boolean];
}) {
  return (
    <div className="mx-auto flex w-[900px] max-w-full justify-between">
      {LANE_COLORS.map((lane) => (
        <Keycap
          key={lane.lane}
          lane={lane.lane}
          label={keys[lane.lane]}
          stringName={lane.name}
          border={lane.border}
          text={lane.text}
          cssVar={lane.cssVar}
          isPressed={pressed[lane.lane]}
        />
      ))}
    </div>
  );
}

function Keycap({
  label,
  stringName,
  border,
  text,
  cssVar,
  isPressed,
}: {
  lane: Lane;
  label: string;
  stringName: string;
  border: string;
  text: string;
  cssVar: string;
  isPressed: boolean;
}) {
  return (
    <div className="flex w-[150px] flex-col items-center gap-1.5">
      <div
        className={cn(
          "flex h-11 w-[54px] items-center justify-center rounded-sm border bg-paper-raised font-mono text-[18px] font-semibold",
          border,
          isPressed ? "text-[#131417]" : text,
        )}
        style={
          isPressed
            ? {
                backgroundColor: oklchColor(cssVar),
                boxShadow: `0 0 18px ${oklchColor(cssVar, 0.5)}`,
              }
            : undefined
        }
      >
        {label.toUpperCase()}
      </div>
      <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
        {stringName} string
      </span>
    </div>
  );
}
