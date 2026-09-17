"use client";

import { cn } from "@/lib/cn";
import { LANE_COLORS, oklchColor } from "../data/laneColors";
import type { JudgeFlash, NoteJudgement } from "../types/practice";

/** How long a flash stays on screen, seconds — measured on the game clock
 *  (`t`), not wall time, so it holds steady while paused. */
const FLASH_DURATION_SEC = 0.65;
/** Fraction of the duration spent fading in / out. */
const FADE_IN = 0.15;
const FADE_OUT = 0.2;

/** The A string's amber — the shared "good, not perfect" color for
 *  Good/Early/Late, matching the highway's own key-row and hit-zone colors. */
const AMBER_VAR = LANE_COLORS[1].cssVar;

interface JudgementStyle {
  bg: string;
  fg: string;
  glow: string;
  big: boolean;
}

const JUDGEMENT_STYLE: Record<NoteJudgement, JudgementStyle> = {
  perfect: {
    bg: "rgb(var(--ink) / 0.24)",
    fg: "rgb(var(--ink))",
    glow: "rgb(var(--ink) / 0.6)",
    big: true,
  },
  good: {
    bg: "rgb(var(--ink) / 0.16)",
    fg: "rgb(var(--ink))",
    glow: "rgb(var(--ink) / 0.45)",
    big: false,
  },
  early: {
    bg: oklchColor(AMBER_VAR, 0.26),
    fg: oklchColor(AMBER_VAR),
    glow: oklchColor(AMBER_VAR, 0.55),
    big: false,
  },
  late: {
    bg: oklchColor(AMBER_VAR, 0.26),
    fg: oklchColor(AMBER_VAR),
    glow: oklchColor(AMBER_VAR, 0.55),
    big: false,
  },
  miss: {
    bg: "rgb(var(--accent) / 0.34)",
    fg: "rgb(var(--accent))",
    glow: "rgb(var(--accent) / 0.65)",
    big: true,
  },
};

function labelFor(flash: JudgeFlash): string {
  const upper = flash.text.toUpperCase();
  if (flash.judgement === "early") return `◂ ${upper}`;
  if (flash.judgement === "late") return `${upper} ▸`;
  return upper;
}

/**
 * A light, transparent wash over the ENTIRE gameplay surface — HUD, highway
 * and key row alike, not just the highway box — plus oversized judgement
 * text. Deliberately loud: a hit's verdict should read even out of the
 * corner of your eye. Meant as the last child of a `relative` wrapper around
 * those three.
 */
export function JudgementFlashOverlay({
  flash,
  t,
}: {
  flash: JudgeFlash | null;
  t: number;
}) {
  if (!flash) return null;
  const elapsed = t - flash.at;
  if (elapsed < 0 || elapsed >= FLASH_DURATION_SEC) return null;

  const progress = elapsed / FLASH_DURATION_SEC;
  const opacity =
    progress < FADE_IN
      ? progress / FADE_IN
      : progress > 1 - FADE_OUT
        ? (1 - progress) / FADE_OUT
        : 1;

  const style = JUDGEMENT_STYLE[flash.judgement];

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-sm"
      style={{ background: style.bg, opacity }}
    >
      <span
        className={cn(
          "font-display font-bold leading-none tracking-[-0.01em]",
          style.big
            ? "text-[13vw] sm:text-8xl"
            : "text-[10.5vw] sm:text-7xl",
        )}
        style={{ color: style.fg, textShadow: `0 0 34px ${style.glow}` }}
      >
        {labelFor(flash)}
      </span>
    </div>
  );
}
