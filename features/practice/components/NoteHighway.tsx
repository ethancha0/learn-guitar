"use client";

import { Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LANE_COLORS, oklchColor } from "../data/laneColors";
import {
  CULL_Z_MAX,
  CULL_Z_MIN,
  CX,
  FAR,
  HIT_Y,
  HIT_ZONE_HEIGHT_AT_HIT,
  HIT_ZONE_WIDTH_AT_HIT,
  HORIZON_Y,
  LANE_BOUNDARIES_AT_HIT,
  depthForOffset,
  perspective,
  projectNote,
  screenX,
} from "../data/projection";
import type {
  JudgeFlash,
  JudgementPop,
  PracticeNote,
  RunPhase,
} from "../types/practice";

const MISS_BORDER = "rgba(237,234,225,0.22)";
const MISS_FILL = "rgba(237,234,225,0.05)";
const MISS_TEXT = "rgba(237,234,225,0.4)";
const INK = "#EDEAE1";
const GROUND_INK = "#131417";

interface OverlayCopy {
  eyebrow: string;
  title: string;
  action: string;
}

const OVERLAY_COPY: Record<Exclude<RunPhase, "running">, OverlayCopy> = {
  idle: { eyebrow: "Rhythm practice", title: "Ready", action: "Start" },
  paused: { eyebrow: "Paused", title: "Paused", action: "Resume" },
  completed: { eyebrow: "Rhythm practice", title: "Chart complete", action: "Run again" },
  failed: { eyebrow: "Rhythm practice", title: "Run ended", action: "Run again" },
};

export function NoteHighway({
  notes,
  t,
  lookaheadSec,
  beatSec,
  barStartSec,
  pops,
  flash,
  phase,
  score,
  accuracy,
  bestCombo,
  keys,
  showFretNumbers,
  onPrimaryAction,
  containerRef,
  onFocusSurface,
  onFocusChange,
}: {
  notes: readonly PracticeNote[];
  t: number;
  lookaheadSec: number;
  beatSec: readonly number[];
  barStartSec: readonly number[];
  pops: readonly JudgementPop[];
  flash: JudgeFlash | null;
  phase: RunPhase;
  score: number;
  accuracy: number;
  bestCombo: number;
  keys: readonly [string, string, string, string];
  showFretNumbers: boolean;
  onPrimaryAction: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onFocusSurface: () => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const [bL, bLM, bC, bRM, bR] = LANE_BOUNDARIES_AT_HIT;
  const boundaries = [bL, bLM, bC, bRM, bR];

  const horizonPoint = (x: number) => ({ x: screenX(x, FAR), y: HORIZON_Y });

  // Beat/bar lines within the lookahead window, nearest first so overdraw
  // favours whatever is closest to the hit line.
  const barTimeSet = new Set(barStartSec.map((s) => Math.round(s * 1000)));
  const visibleBeats = beatSec
    .map((time) => ({ time, z: depthForOffset(time - t, lookaheadSec) }))
    .filter((b) => b.z >= 0 && b.z <= 1)
    .sort((a, b) => b.z - a.z);

  const visibleNotes = notes.filter((n) => {
    if (n.state !== null && n.state !== "miss") return false;
    const z = depthForOffset(n.t - t, lookaheadSec);
    return z >= CULL_Z_MIN && z <= CULL_Z_MAX;
  });

  const overlay = phase === "running" ? null : OVERLAY_COPY[phase];
  const hint = `Hit ${keys.map((k) => k.toUpperCase()).join(" ")} as each note crosses the line`;

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      onClick={onFocusSurface}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      className="relative mx-auto aspect-[1240/520] w-full max-w-[1240px] overflow-hidden rounded-sm outline-none"
    >
      <svg
        viewBox="0 0 1240 520"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="practice-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0E0F12" />
            <stop offset="40%" stopColor="#131417" />
            <stop offset="100%" stopColor="#16181C" />
          </linearGradient>
        </defs>

        <rect width={1240} height={520} fill="url(#practice-ground)" />

        {/* Alternating lane fills, lanes 1 and 3. */}
        {[1, 3].map((lane) => {
          const left = boundaries[lane];
          const right = boundaries[lane + 1];
          const farLeft = horizonPoint(left);
          const farRight = horizonPoint(right);
          return (
            <polygon
              key={lane}
              points={`${left},${HIT_Y} ${right},${HIT_Y} ${farRight.x},${farRight.y} ${farLeft.x},${farLeft.y}`}
              fill="rgba(237,234,225,0.028)"
            />
          );
        })}

        {/* Lane boundary lines. */}
        {boundaries.map((x, i) => {
          const far = horizonPoint(x);
          const outer = i === 0 || i === boundaries.length - 1;
          return (
            <line
              key={x}
              x1={x}
              y1={HIT_Y}
              x2={far.x}
              y2={far.y}
              stroke={`rgba(237,234,225,${outer ? 0.16 : 0.1})`}
              strokeWidth={1}
            />
          );
        })}

        {/* Lane center rails, one per string. */}
        {LANE_COLORS.map((lane) => {
          const cx = [245, 495, 745, 995][lane.lane];
          const far = horizonPoint(cx);
          return (
            <line
              key={lane.lane}
              x1={cx}
              y1={HIT_Y}
              x2={far.x}
              y2={far.y}
              stroke={oklchColor(lane.cssVar, 0.32)}
              strokeWidth={1}
            />
          );
        })}

        {/* Horizon rule. */}
        <line x1={529.09} y1={30} x2={710.91} y2={30} stroke="rgba(237,234,225,0.2)" />

        {/* Hit-zone targets — sized bigger than the note itself so the
            landing target reads as generous, matching the wider hit window. */}
        {LANE_COLORS.map((lane) => {
          const cx = [245, 495, 745, 995][lane.lane];
          return (
            <rect
              key={lane.lane}
              x={cx - HIT_ZONE_WIDTH_AT_HIT / 2}
              y={HIT_Y - HIT_ZONE_HEIGHT_AT_HIT / 2}
              width={HIT_ZONE_WIDTH_AT_HIT}
              height={HIT_ZONE_HEIGHT_AT_HIT}
              rx={2}
              fill="none"
              stroke={oklchColor(lane.cssVar, 0.55)}
              strokeWidth={1}
            />
          );
        })}

        {/* Beat / bar lines (moving). */}
        {visibleBeats.map((b, i) => {
          const isBar = barTimeSet.has(Math.round(b.time * 1000));
          const f = perspective(b.z);
          const left = { x: screenX(120, f), y: HIT_Y - (HIT_Y - HORIZON_Y) * (1 - f) / (1 - FAR) };
          const right = { x: screenX(1120, f), y: left.y };
          const opacity = (isBar ? 0.1 : 0.04) + 0.16 * (1 - b.z);
          return (
            <line
              key={i}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              stroke={INK}
              strokeOpacity={opacity}
              strokeWidth={isBar ? 1.5 : 1}
            />
          );
        })}

        {/* Bar numbers. */}
        {barStartSec.map((start, i) => {
          const z = depthForOffset(start - t, lookaheadSec);
          if (z < 0 || z > 1) return null;
          const f = perspective(z);
          const left = { x: screenX(120, f), y: HIT_Y - (HIT_Y - HORIZON_Y) * (1 - f) / (1 - FAR) };
          return (
            <text
              key={i}
              x={left.x - 26}
              y={left.y}
              fontSize={7 + 5 * f}
              fontFamily="var(--font-plex-mono)"
              letterSpacing="0.1em"
              fill={`rgba(237,234,225,${0.2 + 0.4 * f})`}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {i + 1}
            </text>
          );
        })}

        {/* Notes. */}
        {visibleNotes.map((n) => {
          const z = depthForOffset(n.t - t, lookaheadSec);
          const p = projectNote(n.lane, z);
          const missed = n.state === "miss";
          const laneColor = LANE_COLORS[n.lane];
          return (
            <g key={n.id} opacity={missed ? 0.5 : 1}>
              <rect
                x={p.x - p.width / 2}
                y={p.y - p.height / 2}
                width={p.width}
                height={p.height}
                rx={2}
                fill={missed ? MISS_FILL : oklchColor(laneColor.cssVar, 0.9)}
                stroke={missed ? MISS_BORDER : oklchColor(laneColor.cssVar)}
                strokeWidth={1}
              />
              {showFretNumbers && (
                <text
                  x={p.x}
                  y={p.y}
                  fontSize={Math.max(6, 15 * p.f)}
                  fontFamily="var(--font-plex-mono)"
                  fontWeight={600}
                  fill={missed ? MISS_TEXT : GROUND_INK}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {n.fret}
                </text>
              )}
            </g>
          );
        })}

        {/* Judgement pops. */}
        {pops.map((pop) => {
          const cx = [245, 495, 745, 995][pop.lane];
          const elapsed = Math.max(0, t - pop.at);
          const progress = Math.min(1, elapsed / 0.5);
          const dy = -26 * progress;
          const opacity = 1 - progress;
          const laneColor = LANE_COLORS[pop.lane];
          return (
            <text
              key={pop.id}
              x={cx}
              y={HIT_Y + dy}
              fontSize={10}
              fontWeight={600}
              letterSpacing="0.18em"
              textAnchor="middle"
              fill={pop.judgement === "perfect" ? INK : oklchColor(laneColor.cssVar)}
              opacity={opacity}
              style={{ textTransform: "uppercase" }}
            >
              {pop.text}
            </text>
          );
        })}

        {/* Judgement flash. */}
        {flash &&
          (() => {
            const elapsed = Math.max(0, t - flash.at);
            const progress = Math.min(1, elapsed / 0.55);
            if (progress >= 1) return null;
            const color =
              flash.judgement === "perfect"
                ? INK
                : flash.judgement === "miss"
                  ? "rgb(var(--accent))"
                  : oklchColor(LANE_COLORS[0].cssVar);
            return (
              <text
                x={CX}
                y={HIT_Y - 58}
                fontSize={26}
                fontWeight={700}
                textAnchor="middle"
                fill={color}
                opacity={1 - progress}
                fontFamily="var(--font-spectral)"
              >
                {flash.text}
              </text>
            );
          })()}

        {/* Hit line, drawn last so it stays on top. */}
        <line x1={120} y1={HIT_Y} x2={1120} y2={HIT_Y} stroke={INK} strokeOpacity={0.45} strokeWidth={2} />
      </svg>

      {overlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5 bg-[rgba(19,20,23,0.82)] px-6 text-center">
          <p className="font-mono text-[9.5px] uppercase tracking-eyebrow text-ink-muted">
            {overlay.eyebrow}
          </p>
          <h2 className="font-display text-[44px] font-bold tracking-[-0.025em] text-ink">
            {overlay.title}
          </h2>
          <p className="font-display text-[16px] italic text-ink-muted">
            {phase === "completed" || phase === "failed"
              ? `${Math.round(score).toLocaleString()} pts · ${Math.round(accuracy)}% accuracy · best streak ${bestCombo}`
              : hint}
          </p>
          <Button size="lg" onClick={onPrimaryAction}>
            <Play className="h-4 w-4" />
            {overlay.action}
          </Button>
        </div>
      )}
    </div>
  );
}
