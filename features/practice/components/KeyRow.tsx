import { cn } from "@/lib/cn";
import { LANE_COLORS, oklchColor } from "../data/laneColors";
import { keyLabel, type LaneKeys } from "../data/practiceSettings";
import type { Lane } from "../types/practice";

/**
 * The four keycaps under the highway, centered on their lane. A 900px row
 * centered under the 1240px highway, each cap 150px wide so its center lands
 * on the lane center above it.
 */
export function KeyRow({
  keys,
  altKeys,
  pressed,
}: {
  keys: LaneKeys;
  altKeys: LaneKeys;
  pressed: readonly [boolean, boolean, boolean, boolean];
}) {
  return (
    <div className="mx-auto flex w-[900px] max-w-full justify-between">
      {LANE_COLORS.map((lane) => (
        <Keycap
          key={lane.lane}
          lane={lane.lane}
          label={keys[lane.lane]}
          altLabel={altKeys[lane.lane]}
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
  altLabel,
  stringName,
  border,
  text,
  cssVar,
  isPressed,
}: {
  lane: Lane;
  label: string;
  altLabel: string;
  stringName: string;
  border: string;
  text: string;
  cssVar: string;
  isPressed: boolean;
}) {
  const text1 = keyLabel(label);
  const text2 = keyLabel(altLabel);
  return (
    <div className="flex w-[150px] flex-col items-center gap-1.5">
      <div
        className={cn(
          "flex h-11 min-w-[54px] items-center justify-center gap-1.5 rounded-sm border bg-paper-raised px-2 font-mono font-semibold",
          text1.length > 1 || text2.length > 1 ? "text-[12px]" : "text-[18px]",
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
        {text1}
        {text2 && <span className="opacity-60">/ {text2}</span>}
      </div>
      <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
        {stringName} string
      </span>
    </div>
  );
}
