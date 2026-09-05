"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { REEL_STEPS } from "../data/reelScript";
import { LibraryStage } from "./LibraryStage";
import { PlayerStage } from "./PlayerStage";

/**
 * The reel is composed at one fixed size and scaled to fit whatever column it
 * is dropped into, so the clip is framed identically on every screen and can
 * be recorded without a layout hunting for its breakpoint.
 */
const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 540;

/** Long enough to read as a cut, short enough not to eat a step. */
const CUT_SEC = 0.26;
const CAMERA_BY_STEP = {
  import: { scale: 1.03, x: 0, y: 6 },
  play: { scale: 1, x: 15, y: -5 },
  mix: { scale: 1.2, x: -62, y: -4 },
} as const;

/**
 * A five-to-eight second montage of the app, played on mock chrome rather than
 * the real player: no audio context, no song store, nothing to load. Loops
 * forever, which is what a clip of this length is for.
 */
export function ShowcaseReel() {
  const [step, setStep] = useState(0);
  /** Bumped on every wrap so each pass replays its entrance animations. */
  const [cycle, setCycle] = useState(0);

  const frame = useRef<HTMLDivElement>(null);
  const scale = useFitScale(frame);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (step + 1 < REEL_STEPS.length) {
        setStep(step + 1);
      } else {
        setStep(0);
        setCycle((previous) => previous + 1);
      }
    }, REEL_STEPS[step].durationMs);
    return () => window.clearTimeout(timer);
  }, [step, cycle]);

  const current = REEL_STEPS[step];

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={frame}
        className="w-full"
        style={{ height: STAGE_HEIGHT * scale }}
      >
        <div
          className="relative flex flex-col overflow-hidden rounded-sm border border-rule-strong bg-paper-raised shadow-sheet"
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <StageHeader label={current.label} index={step} />

          <div className="relative min-h-0 flex-1">
            <AnimatePresence>
              <motion.div
                key={`${cycle}-${current.stage}`}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{
                  opacity: 1,
                  ...CAMERA_BY_STEP[current.id],
                }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: CUT_SEC, ease: "easeOut" }}
                style={{ transformOrigin: "50% 50%" }}
              >
                {current.stage === "library" ? (
                  <LibraryStage />
                ) : (
                  <PlayerStage mixerOpen={current.id === "mix"} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <StageFooter caption={current.caption} stepId={current.id} />
          <StepRule step={step} cycle={cycle} />
        </div>
      </div>
    </MotionConfig>
  );
}

/** Barline mark, wordmark, and which of the three steps is running. */
function StageHeader({ label, index }: { label: string; index: number }) {
  return (
    <div className="flex h-[42px] shrink-0 items-center justify-between border-b border-rule px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[17px] items-stretch gap-[2px]" aria-hidden>
          <span className="w-[4px] bg-ink" />
          <span className="w-[1.5px] bg-ink" />
        </span>
        <span className="font-display text-[15px] font-bold tracking-[-0.01em] text-ink">
          Fretly
        </span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[9.5px] uppercase tracking-eyebrow text-ink-faint">
        <span className="text-ink-muted">{label}</span>
        <span aria-hidden className="h-[9px] w-px bg-rule" />
        <span className="tabular-nums">
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(REEL_STEPS.length).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

/** The line under the stage. Swaps with the step rather than crossfading in place. */
function StageFooter({ caption, stepId }: { caption: string; stepId: string }) {
  return (
    <div className="relative flex h-[52px] shrink-0 items-center overflow-hidden border-t border-rule px-6">
      <AnimatePresence mode="wait">
        <motion.p
          key={stepId}
          className="font-display text-[16px] italic text-ink-muted"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {caption}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/**
 * Three hairlines along the bottom edge — one per step, the running one
 * inking in over its own duration. Doubles as the loop's progress bar.
 */
function StepRule({ step, cycle }: { step: number; cycle: number }) {
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 flex h-[2px] gap-[2px]">
      {REEL_STEPS.map((entry, index) => (
        <div key={entry.id} className="relative flex-1 bg-rule">
          <motion.div
            key={`${cycle}-${step}-${index}`}
            className="absolute inset-0 origin-left bg-accent"
            initial={{ scaleX: index < step ? 1 : 0 }}
            animate={{ scaleX: index <= step ? 1 : 0 }}
            transition={
              index === step
                ? { duration: entry.durationMs / 1000, ease: "linear" }
                : { duration: 0 }
            }
          />
        </div>
      ))}
    </div>
  );
}

/** Shrinks the fixed composition to the width it has been given, never past 1:1. */
function useFitScale(ref: RefObject<HTMLElement | null>) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / STAGE_WIDTH));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return scale;
}
