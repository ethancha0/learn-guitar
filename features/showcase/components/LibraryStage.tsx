"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AudioLines, Check, Guitar, Music4, Search, Youtube } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, engagedKey } from "@/components/ui/Button";
import { REEL_QUERY, REEL_RESULTS } from "../data/reelFixtures";

/** Milliseconds from the stage appearing. Read the file top to bottom as a script. */
const TYPE_STARTS_AT = 170;
const TYPE_PER_CHAR = 74;
const RESULTS_AT = 980;
const RESULT_STAGGER = 95;
const PICKED_AT = 1450;
const ALIGN_AT = 1560;
const ALIGN_FOR = 720;
const SYNCED_AT = 2290;

/** The two flips the stage makes: a result is picked, then the align finishes. */
const BEATS = [PICKED_AT, SYNCED_AT] as const;

/**
 * Step one: a song arrives. A search runs against the tab and video sources,
 * a result is picked, and the tab is aligned to the recording — the whole
 * import, compressed to the length of a held breath.
 */
export function LibraryStage() {
  const reduced = useReducedMotion() ?? false;
  const typed = useTypewriter(REEL_QUERY, reduced);
  const beat = useBeats(BEATS);

  const picked = beat >= 1;
  const synced = beat >= 2;

  return (
    <div className="flex h-full flex-col px-[46px] py-[34px]">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9.5px] uppercase tracking-eyebrow text-ink-faint">
          Import · new entry
        </p>
        <div className="flex items-center gap-1.5">
          <SourceChip icon={<Guitar className="h-3 w-3" />} label="Songsterr" active />
          <SourceChip icon={<Youtube className="h-3 w-3" />} label="YouTube" active />
        </div>
      </div>

      {/* The field, mirroring `Input` — ink rule, paper fill, Spectral text. */}
      <div className="mt-3 flex items-center gap-3 rounded-sm border border-ink bg-paper px-3.5 h-11">
        <Search className="h-4 w-4 shrink-0 text-ink-faint" />
        <p className="flex min-w-0 flex-1 items-center font-display text-[15px] text-ink">
          {typed || (
            <span className="italic text-ink-faint">Search a song or paste a link</span>
          )}
          <Caret visible={!reduced && typed.length < REEL_QUERY.length} />
        </p>
        <Button size="sm" className="shrink-0">
          Search
        </Button>
      </div>

      <ul className="mt-6">
        {REEL_RESULTS.map((result, index) => (
          <motion.li
            key={result.title}
            className="relative grid grid-cols-[34px_1fr_150px_78px_54px] items-center gap-4 border-b border-rule px-2 py-[13px]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.26,
              ease: "easeOut",
              delay: (RESULTS_AT + index * RESULT_STAGGER) / 1000,
            }}
          >
            {/* The pick reads as a wash under the row, the way a hover does. */}
            <motion.span
              aria-hidden
              className="absolute inset-y-0 -left-2 -right-2 bg-[var(--wash)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: index === 0 && picked ? 1 : 0 }}
              transition={{ duration: 0.18 }}
            />
            <span className="relative font-mono text-xs font-semibold text-accent">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={cn(
                "relative truncate font-display text-[19px] font-semibold tracking-[-0.015em] transition-colors",
                index === 0 && picked ? "text-accent" : "text-ink",
              )}
            >
              {result.title}
            </span>
            <span className="relative truncate font-display text-sm italic text-ink-muted">
              {result.artist}
            </span>
            <span className="relative text-right font-mono text-xs text-ink">
              {result.duration}
            </span>
            <span className="relative inline-flex justify-self-end gap-[7px] text-ink-faint">
              {result.hasTab && <Music4 className="h-3.5 w-3.5" />}
              {result.hasAudio && <AudioLines className="h-3.5 w-3.5" />}
            </span>
          </motion.li>
        ))}
      </ul>

      <div className="mt-auto flex h-10 items-center gap-4">
        <AnimatePresence mode="wait">
          <motion.p
            key={synced ? "synced" : "aligning"}
            className={cn(
              "flex items-center gap-2 font-mono text-[10px] uppercase tracking-label",
              synced ? "text-ink" : "text-ink-faint",
            )}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {synced && <Check className="h-3.5 w-3.5 text-accent" />}
            {synced ? "Synced · ready to play" : "Aligning tab to recording"}
          </motion.p>
        </AnimatePresence>

        <div className="h-[2px] w-[240px] bg-track">
          <motion.div
            className="h-full origin-left bg-accent"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{
              duration: ALIGN_FOR / 1000,
              ease: "easeInOut",
              delay: ALIGN_AT / 1000,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SourceChip({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-button",
        active ? engagedKey : "border-rule text-ink-muted",
      )}
    >
      {icon}
      {label}
    </span>
  );
}

/** A block caret, not a bar: the field is set in the same ink as the score. */
function Caret({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <motion.span
      aria-hidden
      className="ml-[2px] inline-block h-[15px] w-[7px] bg-ink"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1.02, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
    />
  );
}

/**
 * Reveals `text` a character at a time by re-scheduling itself, so the timer
 * stops on its own once the query is typed out.
 */
function useTypewriter(text: string, skip: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (skip) {
      setCount(text.length);
      return;
    }
    if (count >= text.length) return;

    const timer = window.setTimeout(
      () => setCount(count + 1),
      count === 0 ? TYPE_STARTS_AT : TYPE_PER_CHAR,
    );
    return () => window.clearTimeout(timer);
  }, [count, skip, text]);

  return text.slice(0, count);
}

/** How many of `marks` (ms from mount) have passed. */
function useBeats(marks: readonly number[]) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const timers = marks.map((at, index) =>
      window.setTimeout(() => setBeat(index + 1), at),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [marks]);

  return beat;
}
