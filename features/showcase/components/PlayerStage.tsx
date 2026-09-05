"use client";

import { useEffect, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { Gauge, Pause, Repeat, SkipBack, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, engagedKey } from "@/components/ui/Button";
import { formatDuration } from "@/features/library/components/formatDuration";
import {
  REEL_BARS_PCT,
  REEL_CHANNELS,
  REEL_NOTES,
  REEL_SONG,
  REEL_SPEED_FROM_PCT,
  REEL_SPEED_TO_PCT,
  REEL_STRING_COUNT,
} from "../data/reelFixtures";
import {
  REEL_SLOW_SPEED,
  SWEEP_DURATION_MS,
  SWEEP_END_PCT,
  SWEEP_SLOWS_AT_PCT,
  SWEEP_START_PCT,
  stepDurationMs,
  sweepTimeMs,
} from "../data/reelScript";

/**
 * The sheet keeps its paper colour in the dark theme — alphaTab engraves its
 * glyphs in ink, and inverting a score is its own job — so everything drawn on
 * it is stated in fixed ink rather than the themed tokens.
 */
const SHEET_INK = "#16181c";
const SHEET_ACCENT = "#b3352b";
const SHEET_RULE = "rgba(22, 24, 28, 0.3)";
const SHEET_WASH = "rgba(179, 53, 43, 0.1)";

/** Tab is read top line down, so the strings run high to low. */
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];
const STRING_GAP = 21;
const STAFF_HEIGHT = (REEL_STRING_COUNT - 1) * STRING_GAP;
const NOTATION_LINE_GAP = 8;
const NOTATION_HEIGHT = NOTATION_LINE_GAP * 4;
const TAB_TOP = 98;
const COMBINED_STAFF_HEIGHT = TAB_TOP + STAFF_HEIGHT;
const NOTEHEAD_Y = [24, 18, 12, 7, 20, 14, 9, 4];

const SWEEP_SEC = SWEEP_DURATION_MS / 1000;
/** Where in the sweep the mixer opens and the transport eases off. */
const SLOW_AT_PROGRESS = stepDurationMs("play") / SWEEP_DURATION_MS;

/** Seconds of song covered by each leg of the sweep, at its own speed. */
const PLAY_LEG_SEC = stepDurationMs("play") / 1000;
const MIX_LEG_SEC = (stepDurationMs("mix") / 1000) * REEL_SLOW_SPEED;

/**
 * Steps two and three: the score plays, then the mixer opens over it. Both
 * steps share this stage, so the playhead crosses the cut between them without
 * restarting — it only changes gear, which is the point being made.
 */
export function PlayerStage({ mixerOpen }: { mixerOpen: boolean }) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div className="flex h-full flex-col px-[46px] py-[30px]">
      <Masthead />

      <div className="mt-4 flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ScoreSheet reduced={reduced} />
          <Transport reduced={reduced} slowed={mixerOpen} />
        </div>

        <AnimatePresence>
          {mixerOpen && <MixerPanel key="mixer" reduced={reduced} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** The player's title block, on the same engraved rule the real one uses. */
function Masthead() {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 border-b-2 border-rule-strong pb-2.5">
      <div className="min-w-0">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint">
          Now playing
        </p>
        <h2 className="mt-1.5 truncate font-display text-[30px] font-bold leading-none tracking-[-0.025em] text-ink">
          {REEL_SONG.title}
        </h2>
        <p className="mt-1 truncate font-display text-[15px] italic text-ink-muted">
          {REEL_SONG.artist}
        </p>
      </div>
      <dl className="flex shrink-0 gap-[22px] text-right">
        <MetaPair label="Tempo" value={REEL_SONG.tempo} />
        <MetaPair label="Metre" value={REEL_SONG.metre} />
        <MetaPair label="Tuning" value={REEL_SONG.tuning} tracked />
      </dl>
    </div>
  );
}

function MetaPair({
  label,
  value,
  tracked,
}: {
  label: string;
  value: string;
  tracked?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <dt className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-[15px] text-ink",
          tracked && "tracking-[0.14em]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Four bars of standard notation plus tab under a sweeping playhead. Every
 * timing on the sheet is read off `sweepTimeMs` so the score and playhead stay
 * locked together.
 */
function ScoreSheet({ reduced }: { reduced: boolean }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-sm border border-ink bg-paper-sheet shadow-sheet">
      <div
        className="flex items-center justify-between px-4 py-2 font-mono text-[9px] uppercase tracking-label"
        style={{ color: SHEET_INK, opacity: 0.55 }}
      >
        <span>Guitar · Notation + Tab</span>
        <span>Bars 9–12</span>
      </div>

      <div
        className="absolute inset-x-[26px]"
        style={{ top: 48, height: COMBINED_STAFF_HEIGHT }}
      >
        {/* Bar washes: one rectangle per bar, lit for exactly its own span. */}
        {!reduced &&
          REEL_BARS_PCT.map(([start, end]) => {
            const from = sweepTimeMs(start);
            const to = sweepTimeMs(end);
            return (
              <motion.span
                key={start}
                aria-hidden
                className="absolute"
                style={{
                  left: `${start}%`,
                  width: `${end - start}%`,
                  top: -8,
                  bottom: -12,
                  background: SHEET_WASH,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 1, 0] }}
                transition={{
                  duration: (to - from) / 1000,
                  delay: from / 1000,
                  times: [0, 0.05, 0.95, 1],
                  ease: "linear",
                }}
              />
            );
          })}

        {/* Standard notation staff, paired with the tab below it. */}
        {Array.from({ length: 5 }, (_, line) => (
          <motion.span
            key={`notation-${line}`}
            aria-hidden
            className="absolute left-0 right-0 h-px origin-left"
            style={{
              top: line * NOTATION_LINE_GAP,
              background: SHEET_RULE,
            }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.36, ease: "easeOut", delay: line * 0.025 }}
          />
        ))}

        <span
          aria-hidden
          className="absolute left-0 font-display text-[28px] leading-none"
          style={{ top: -10, color: SHEET_INK }}
        >
          𝄞
        </span>

        {REEL_NOTES.map((note, index) => (
          <StandardNote
            key={`note-${note.string}-${note.xPct}`}
            note={note}
            index={index}
            reduced={reduced}
          />
        ))}

        {/* The six tab strings, drawn in from the nut. */}
        {Array.from({ length: REEL_STRING_COUNT }, (_, string) => (
          <motion.span
            key={string}
            aria-hidden
            className="absolute left-0 right-0 h-px origin-left"
            style={{
              top: TAB_TOP + string * STRING_GAP,
              background: SHEET_RULE,
            }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: string * 0.03 }}
          />
        ))}

        {STRING_LABELS.map((label, string) => (
          <span
            key={label}
            aria-hidden
            className="absolute left-0 font-mono text-[10px]"
            style={{
              top: string * STRING_GAP - 7,
              transform: `translateY(${TAB_TOP}px)`,
              color: SHEET_INK,
              background: "rgb(var(--paper-sheet))",
              paddingRight: 4,
            }}
          >
            {label}
          </span>
        ))}

        {REEL_BARS_PCT.slice(1).map(([start]) => (
          <span
            key={start}
            aria-hidden
            className="absolute w-px"
            style={{
              left: `${start}%`,
              top: 0,
              height: COMBINED_STAFF_HEIGHT,
              background: SHEET_RULE,
            }}
          />
        ))}

        {REEL_NOTES.map((note) => (
          <Fret key={`${note.string}-${note.xPct}`} note={note} reduced={reduced} />
        ))}

        {!reduced && (
          <motion.span
            aria-hidden
            className="absolute w-[2px]"
            style={{ top: -14, bottom: -14, background: SHEET_ACCENT }}
            initial={{ left: `${SWEEP_START_PCT}%` }}
            animate={{
              left: [
                `${SWEEP_START_PCT}%`,
                `${SWEEP_SLOWS_AT_PCT}%`,
                `${SWEEP_END_PCT}%`,
              ],
            }}
            transition={{
              duration: SWEEP_SEC,
              times: [0, SLOW_AT_PROGRESS, 1],
              ease: "linear",
            }}
          />
        )}
      </div>
    </div>
  );
}

function StandardNote({
  note,
  index,
  reduced,
}: {
  note: (typeof REEL_NOTES)[number];
  index: number;
  reduced: boolean;
}) {
  const lightsAt = sweepTimeMs(note.xPct) / 1000;
  const y = NOTEHEAD_Y[index % NOTEHEAD_Y.length];
  const stemUp = index % 4 < 2;

  return (
    <span
      className="absolute"
      style={{
        left: `${note.xPct}%`,
        top: y,
        transform: "translate(-50%, -50%)",
      }}
    >
      <motion.span
        className="relative block h-[9px] w-[13px] rounded-full border"
        style={{
          borderColor: SHEET_INK,
          background: "rgb(var(--paper-sheet))",
          transform: "rotate(-18deg)",
        }}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.28,
          ease: "easeOut",
          delay: 0.12 + note.xPct * 0.004,
        }}
      >
        <span
          aria-hidden
          className="absolute w-px"
          style={{
            left: stemUp ? 10 : 2,
            top: stemUp ? -24 : 7,
            height: 26,
            background: SHEET_INK,
          }}
        />
        {!reduced && (
          <motion.span
            aria-hidden
            className="absolute inset-[-1px] rounded-full border"
            style={{
              borderColor: SHEET_ACCENT,
              background: "rgb(var(--paper-sheet))",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 0.62,
              delay: lightsAt,
              times: [0, 0.08, 0.45, 1],
              ease: "easeOut",
            }}
          />
        )}
      </motion.span>
    </span>
  );
}

/**
 * One fret number. The lit copy is a second span stacked over the first rather
 * than a colour tween, so the highlight reads as ink and never interpolates
 * through a muddy middle.
 */
function Fret({
  note,
  reduced,
}: {
  note: (typeof REEL_NOTES)[number];
  reduced: boolean;
}) {
  const lightsAt = sweepTimeMs(note.xPct) / 1000;

  return (
    <span
      className="absolute"
      style={{
        left: `${note.xPct}%`,
        top: TAB_TOP + note.string * STRING_GAP - 8,
        transform: "translateX(-50%)",
      }}
    >
      <motion.span
        className="relative block px-[3px] font-mono text-[13px] font-semibold leading-4"
        style={{ background: "rgb(var(--paper-sheet))", color: SHEET_INK }}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut", delay: 0.1 + note.xPct * 0.004 }}
      >
        {note.fret}
        {!reduced && (
          <motion.span
            aria-hidden
            className="absolute inset-0 px-[3px]"
            style={{ background: "rgb(var(--paper-sheet))", color: SHEET_ACCENT }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 0.62,
              delay: lightsAt,
              times: [0, 0.08, 0.45, 1],
              ease: "easeOut",
            }}
          >
            {note.fret}
          </motion.span>
        )}
      </motion.span>
    </span>
  );
}

/** The transport keys, the clock, and the speed the mixer is about to change. */
function Transport({ reduced, slowed }: { reduced: boolean; slowed: boolean }) {
  const seconds = useMotionValue(REEL_SONG.startSec);
  const clock = useTransform(seconds, (value) => formatDuration(value));

  useEffect(() => {
    if (reduced) return;
    const controls = animate(
      seconds,
      [
        REEL_SONG.startSec,
        REEL_SONG.startSec + PLAY_LEG_SEC,
        REEL_SONG.startSec + PLAY_LEG_SEC + MIX_LEG_SEC,
      ],
      {
        duration: SWEEP_SEC,
        times: [0, SLOW_AT_PROGRESS, 1],
        ease: "linear",
      },
    );
    return () => controls.stop();
  }, [reduced, seconds]);

  const played = REEL_SONG.startSec / REEL_SONG.durationSec;

  return (
    <div className="flex h-[46px] shrink-0 items-center gap-4 rounded-sm border border-rule-strong bg-paper-raised px-4">
      <Button variant="ghost" size="icon" tabIndex={-1} aria-hidden>
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button size="icon" tabIndex={-1} aria-hidden>
        <Pause className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-3 font-mono text-xs text-ink-muted">
        <motion.span className="tabular-nums">{clock}</motion.span>
        <div className="h-0.5 flex-1 overflow-hidden bg-track">
          <motion.div
            className="h-full origin-left bg-accent"
            initial={{ scaleX: played }}
            animate={{ scaleX: played + 0.016 }}
            transition={{ duration: SWEEP_SEC, ease: "linear" }}
            style={{ width: "100%" }}
          />
        </div>
        <span className="tabular-nums">
          {formatDuration(REEL_SONG.durationSec)}
        </span>
      </div>

      <span className="inline-flex items-center gap-1.5 rounded-sm border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-button text-ink">
        <Gauge className="h-3 w-3 text-ink-faint" />
        <AnimatePresence mode="wait">
          <motion.span
            key={slowed ? "slow" : "full"}
            className="tabular-nums"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {slowed ? "0.75×" : "1.00×"}
          </motion.span>
        </AnimatePresence>
      </span>

      <Button variant="ghost" size="icon" tabIndex={-1} aria-hidden>
        <Repeat className="h-4 w-4" />
      </Button>
      <span
        className={cn(
          "inline-flex h-[30px] w-[30px] items-center justify-center rounded-sm border",
          slowed ? engagedKey : "border-rule text-ink",
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </span>
    </div>
  );
}

/** Step three's panel. Opens by taking width from the score, the way it does in the app. */
function MixerPanel({ reduced }: { reduced: boolean }) {
  const tabOnly = useDelayedFlag(1600);

  return (
    <motion.aside
      className="shrink-0 overflow-hidden"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.34, ease: "easeOut" }}
    >
      <div className="ml-6 flex h-full w-[296px] flex-col gap-4 border-l border-rule pl-6">
        <MixerRow delay={0.14}>
          <p className="font-mono text-[9.5px] uppercase tracking-eyebrow text-ink-faint">
            Mixer
          </p>
        </MixerRow>

        <MixerRow delay={0.22}>
          <div className="flex items-end justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
              Speed
            </span>
            <SpeedReadout reduced={reduced} />
          </div>
          <Fader
            reduced={reduced}
            from={REEL_SPEED_FROM_PCT}
            to={REEL_SPEED_TO_PCT}
            delay={0.45}
          />
        </MixerRow>

        <div className="h-px bg-rule" />

        {REEL_CHANNELS.map((channel, index) => (
          <MixerRow key={channel.name} delay={0.3 + index * 0.07}>
            <div className="flex items-end justify-between">
              <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
                {channel.name}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                {reduced ? channel.to : channel.from}
              </span>
            </div>
            <Fader
              reduced={reduced}
              from={channel.from}
              to={channel.to}
              delay={0.6 + index * 0.12}
            />
          </MixerRow>
        ))}

        <div className="mt-auto flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 items-center rounded-sm border px-3 font-mono text-[10px] uppercase tracking-button transition-colors",
              tabOnly ? engagedKey : "border-rule text-ink",
            )}
          >
            Tab only
          </span>
          <span className="inline-flex h-8 items-center rounded-sm px-3 font-mono text-[10px] uppercase tracking-button text-ink-faint">
            Reset
          </span>
        </div>
      </div>
    </motion.aside>
  );
}

function MixerRow({
  delay,
  children,
}: {
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="flex flex-col gap-2"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.26, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

/** The speed figure, counted down rather than cut, so the change is legible. */
function SpeedReadout({ reduced }: { reduced: boolean }) {
  const percent = useMotionValue(
    reduced ? REEL_SPEED_TO_PCT : REEL_SPEED_FROM_PCT,
  );
  const label = useTransform(percent, (value) => `${Math.round(value)}%`);

  useEffect(() => {
    if (reduced) return;
    const controls = animate(percent, REEL_SPEED_TO_PCT, {
      duration: 0.7,
      delay: 0.45,
      ease: "easeInOut",
    });
    return () => controls.stop();
  }, [percent, reduced]);

  return (
    <motion.span className="font-display text-[28px] font-bold leading-none tabular-nums text-ink">
      {label}
    </motion.span>
  );
}

/** A hairline track with an inked thumb — the slider the rest of the app uses. */
function Fader({
  reduced,
  from,
  to,
  delay,
}: {
  reduced: boolean;
  from: number;
  to: number;
  delay: number;
}) {
  return (
    <div className="relative h-3">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-track" />
      <motion.span
        className="absolute top-0 h-3 w-[2px] bg-ink"
        initial={{ left: `${reduced ? to : from}%` }}
        animate={{ left: `${to}%` }}
        transition={reduced ? { duration: 0 } : { duration: 0.7, delay, ease: "easeInOut" }}
      />
    </div>
  );
}

/** Flips true once, `ms` after mounting. */
function useDelayedFlag(ms: number) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setOn(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);

  return on;
}
