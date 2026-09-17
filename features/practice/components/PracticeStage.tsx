"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Song } from "@/features/library/types/song";
import {
  getAudioSync,
  getPreferredTrackIndex,
} from "@/features/library/data/songStore";
import { base64ToBytes } from "@/features/library/data/tabFile";
import { getBackingAudio } from "@/features/player/data/audioStore";
import { buildPlaybackSyncMap } from "@/features/player/data/buildSyncMap";
import { AudioClock } from "@/features/player/data/audioClock";
import { getAudioContext, unlockAudio } from "@/features/player/data/audioEngine";
import type { SyncMap } from "@/features/player/data/syncMap";
import { buildChart, UnsupportedTrackError } from "../data/buildChart";
import {
  applyHitCondition,
  applyMissCondition,
  findNearestNote,
  judgeOffset,
  scoreForJudgement,
} from "../data/judge";
import { LANE_COLORS } from "../data/laneColors";
import {
  DEFAULT_PRACTICE_SETTINGS,
  getPracticeBest,
  getPracticeSettings,
  recordPracticeRun,
  setPracticeSettings,
  type PracticeSettings,
} from "../data/practiceSettings";
import {
  EMPTY_JUDGE_COUNTS,
  type JudgeFlash,
  type JudgementPop,
  type NoteJudgement,
  type PracticeChart,
  type PracticeNote,
  type RunPhase,
} from "../types/practice";
import { KeyRow } from "./KeyRow";
import { NoteHighway } from "./NoteHighway";
import { PracticeHud } from "./PracticeHud";
import { PracticeSettingsDialog } from "./PracticeSettingsDialog";
import { PracticeTransport } from "./PracticeTransport";
import { RunSummary, type RunSummaryData } from "./RunSummary";

const LEAD_IN_SEC = 1.2;
const WEAK_WINDOW_BARS = 4;
const BAR_PASS_THRESHOLD = 70;
const POP_LIFETIME_SEC = 0.6;

const JUDGEMENT_LABEL: Record<NoteJudgement, string> = {
  perfect: "Perfect",
  good: "Good",
  early: "Early",
  late: "Late",
  miss: "Miss",
};

const DIFFICULTY_LABEL: Record<Song["difficulty"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function PracticeStage({
  songId,
  song,
  tabData,
}: {
  songId: string;
  song: Song;
  tabData: string;
}) {
  const router = useRouter();
  const trackIndex = getPreferredTrackIndex(songId) ?? 0;

  // --- chart -----------------------------------------------------------------
  const [chart, setChart] = useState<PracticeChart | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChart(null);
    setChartError(null);
    buildChart(base64ToBytes(tabData), trackIndex)
      .then((c) => {
        if (!cancelled) setChart(c);
      })
      .catch((err) => {
        if (cancelled) return;
        setChartError(
          err instanceof UnsupportedTrackError
            ? err.message
            : "Could not build a rhythm chart for this song.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [tabData, trackIndex]);

  // --- audio + sync ------------------------------------------------------------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioClockRef = useRef<AudioClock | null>(null);
  const syncMapRef = useRef<SyncMap | null>(null);
  const [hasBacking, setHasBacking] = useState(false);
  const [audioDurationSec, setAudioDurationSec] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    let cleanup: (() => void) | undefined;
    setHasBacking(false);
    setAudioDurationSec(0);
    getBackingAudio(songId).then((blob) => {
      if (cancelled || !blob || !audioRef.current) return;
      const typed =
        blob.type && blob.type.startsWith("audio/")
          ? blob
          : new Blob([blob], { type: "audio/mpeg" });
      url = URL.createObjectURL(typed);
      const audio = audioRef.current;
      audio.src = url;
      audio.load();
      setHasBacking(true);
      const onMeta = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setAudioDurationSec(audio.duration);
        }
      };
      audio.addEventListener("loadedmetadata", onMeta);
      audio.addEventListener("durationchange", onMeta);
      cleanup = () => {
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("durationchange", onMeta);
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
      if (url) URL.revokeObjectURL(url);
    };
  }, [songId]);

  const syncMap = useMemo(() => {
    if (!chart) return null;
    const stored = getAudioSync(songId);
    return buildPlaybackSyncMap({
      stored: stored?.syncMap ?? null,
      offsetMs: stored?.offsetMs ?? 0,
      scoreEndSec: chart.durationSec,
      audioDurationSec,
    }).syncMap;
  }, [songId, chart, audioDurationSec]);
  syncMapRef.current = syncMap;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasBacking) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const clock = new AudioClock(audio, { context: ctx });
    audioClockRef.current = clock;
    return () => {
      clock.dispose();
      audioClockRef.current = null;
    };
  }, [hasBacking]);

  const canPlay = hasBacking && syncMap != null;

  // --- settings ----------------------------------------------------------------
  const [settings, setSettingsState] = useState<PracticeSettings>(
    DEFAULT_PRACTICE_SETTINGS,
  );
  useEffect(() => setSettingsState(getPracticeSettings()), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  function updateSettings(next: PracticeSettings) {
    setSettingsState(next);
    setPracticeSettings(next);
  }

  // --- run state -----------------------------------------------------------------
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [t, setT] = useState(-LEAD_IN_SEC);
  const [speed, setSpeed] = useState(1);
  const [notes, setNotes] = useState<PracticeNote[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [condition, setCondition] = useState(100);
  const [judged, setJudged] = useState(0);
  const [hits, setHits] = useState(0);
  const [judgeCounts, setJudgeCounts] = useState(EMPTY_JUDGE_COUNTS);
  const [pressed, setPressed] = useState<[boolean, boolean, boolean, boolean]>([
    false,
    false,
    false,
    false,
  ]);
  const [pops, setPops] = useState<JudgementPop[]>([]);
  const [flash, setFlash] = useState<JudgeFlash | null>(null);
  const [runNumber, setRunNumber] = useState(0);
  const [meanSum, setMeanSum] = useState(0);
  const [meanCount, setMeanCount] = useState(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const conditionRef = useRef(condition);
  conditionRef.current = condition;
  const comboRef = useRef(combo);
  comboRef.current = combo;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    if (chart) setNotes(chart.notes.map((n) => ({ ...n })));
  }, [chart]);

  const startScoreTime = useCallback(() => {
    const firstNote = chart?.notes[0];
    return Math.max(0, (firstNote?.t ?? 0) - LEAD_IN_SEC);
  }, [chart]);

  const resetRun = useCallback(() => {
    if (!chart) return;
    setNotes(chart.notes.map((n) => ({ ...n })));
    setScore(0);
    setCombo(0);
    setBestCombo(0);
    setCondition(100);
    setJudged(0);
    setHits(0);
    setJudgeCounts(EMPTY_JUDGE_COUNTS);
    setPops([]);
    setFlash(null);
    setMeanSum(0);
    setMeanCount(0);
    const start = startScoreTime();
    setT(start);
    const audio = audioRef.current;
    const map = syncMapRef.current;
    if (audio && map) {
      audio.pause();
      audio.currentTime = Math.max(0, map.scoreTimeToAudioTime(start));
    }
  }, [chart, startScoreTime]);

  const registerJudgement = useCallback(
    (judgement: NoteJudgement, lane: number, offsetSec: number, atScoreTime: number) => {
      setJudged((j) => j + 1);
      setJudgeCounts((jc) => ({ ...jc, [judgement]: jc[judgement] + 1 }));
      if (judgement === "miss") {
        setCombo(0);
        setCondition((c) => applyMissCondition(c));
        setFlash({ text: JUDGEMENT_LABEL.miss, judgement: "miss", at: atScoreTime });
      } else {
        setHits((h) => h + 1);
        setScore((s) => s + scoreForJudgement(judgement, comboRef.current));
        setCombo((c) => {
          const next = c + 1;
          setBestCombo((b) => Math.max(b, next));
          return next;
        });
        setCondition((c) => applyHitCondition(c));
        setMeanSum((s) => s + offsetSec * 1000);
        setMeanCount((n) => n + 1);
        setFlash({ text: JUDGEMENT_LABEL[judgement], judgement, at: atScoreTime });
      }
      setPops((prev) => [
        ...prev.filter((p) => atScoreTime - p.at < POP_LIFETIME_SEC),
        {
          id: `${lane}-${atScoreTime.toFixed(3)}-${Math.random().toString(36).slice(2, 6)}`,
          lane: lane as PracticeNote["lane"],
          text: JUDGEMENT_LABEL[judgement],
          judgement,
          at: atScoreTime,
        },
      ]);
    },
    [],
  );

  const endRun = useCallback((result: "completed" | "failed") => {
    audioRef.current?.pause();
    setPhase(result);
  }, []);

  const beginRun = useCallback(() => {
    if (!chart || !canPlay) return;
    unlockAudio();
    resetRun();
    setRunNumber((n) => n + 1);
    setPhase("running");
    void audioRef.current?.play();
  }, [chart, canPlay, resetRun]);

  const handlePrimaryAction = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle" || p === "completed" || p === "failed") {
      beginRun();
    } else if (p === "paused") {
      unlockAudio();
      setPhase("running");
      void audioRef.current?.play();
    } else if (p === "running") {
      audioRef.current?.pause();
      setPhase("paused");
    }
  }, [beginRun]);

  const handleRestart = useCallback(() => {
    audioRef.current?.pause();
    resetRun();
    setPhase("idle");
  }, [resetRun]);

  const handleSpeedChange = useCallback((next: number) => {
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, hasBacking]);

  // --- lane strikes ------------------------------------------------------------
  const strikeLane = useCallback(
    (lane: number) => {
      setPressed((p) => {
        const next = [...p] as [boolean, boolean, boolean, boolean];
        next[lane] = true;
        return next;
      });
      if (phaseRef.current !== "running") return;
      const clock = audioClockRef.current;
      const map = syncMapRef.current;
      if (!clock || !map) return;
      const now = clock.scoreNow(map);
      const target = findNearestNote(
        notesRef.current,
        lane,
        now,
        settingsRef.current.hitWindowSec,
      );
      if (!target) return; // whiff — no combo break
      const offset = now - target.t;
      const judgement = judgeOffset(offset);
      setNotes((prev) =>
        prev.map((n) => (n.id === target.id ? { ...n, state: judgement } : n)),
      );
      registerJudgement(judgement, lane, offset, now);
    },
    [registerJudgement],
  );

  const releaseLane = useCallback((lane: number) => {
    setPressed((p) => {
      const next = [...p] as [boolean, boolean, boolean, boolean];
      next[lane] = false;
      return next;
    });
  }, []);

  // --- keyboard ------------------------------------------------------------------
  const hasFocusRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      );
    }
    function laneForKey(key: string): number {
      return settingsRef.current.keys.findIndex(
        (k) => k.toLowerCase() === key.toLowerCase(),
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || isEditable(e.target) || !hasFocusRef.current) return;
      if (e.key === " ") {
        e.preventDefault();
        handlePrimaryAction();
        return;
      }
      const lane = laneForKey(e.key);
      if (lane === -1) return;
      strikeLane(lane);
    }
    function onKeyUp(e: KeyboardEvent) {
      const lane = laneForKey(e.key);
      if (lane === -1) return;
      releaseLane(lane);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handlePrimaryAction, strikeLane, releaseLane]);

  // --- game clock: advance t, detect misses, end the run ------------------------
  useEffect(() => {
    if (phase !== "running" || !chart) return;
    let raf: number;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const clock = audioClockRef.current;
      const map = syncMapRef.current;
      if (clock && map) {
        const now = clock.scoreNow(map);
        setT(now);

        const hitWindow = settingsRef.current.hitWindowSec;
        const missed = notesRef.current.filter(
          (n) => n.state === null && now > n.t + hitWindow,
        );
        if (missed.length > 0) {
          const missedIds = new Set(missed.map((n) => n.id));
          setNotes((prev) =>
            prev.map((n) => (missedIds.has(n.id) ? { ...n, state: "miss" } : n)),
          );
          for (const n of missed) registerJudgement("miss", n.lane, 0, now);
        }

        if (conditionRef.current <= 0) {
          endRun("failed");
        } else if (now >= chart.durationSec) {
          endRun("completed");
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, chart, registerJudgement, endRun]);

  // --- run summary -----------------------------------------------------------------
  const accuracy = judged > 0 ? (hits / judged) * 100 : 0;

  const runSummaryData = useMemo<RunSummaryData | null>(() => {
    if (!chart || (phase !== "completed" && phase !== "failed")) return null;

    const barHits = new Array(chart.bars).fill(0);
    const barJudged = new Array(chart.bars).fill(0);
    const laneHits = [0, 0, 0, 0];
    const laneJudged = [0, 0, 0, 0];
    for (const n of notes) {
      if (n.state === null) continue;
      const idx = n.bar - 1;
      if (idx >= 0 && idx < chart.bars) {
        barJudged[idx]++;
        if (n.state !== "miss") barHits[idx]++;
      }
      laneJudged[n.lane]++;
      if (n.state !== "miss") laneHits[n.lane]++;
    }
    const perBarAccuracy = barJudged.map((count, i) =>
      count > 0 ? (barHits[i] / count) * 100 : 100,
    );
    const barsFailed = perBarAccuracy.filter(
      (pct, i) => barJudged[i] > 0 && pct < BAR_PASS_THRESHOLD,
    ).length;

    let weakBarRange: { start: number; end: number } | null = null;
    if (chart.bars > 0) {
      const windowSize = Math.min(WEAK_WINDOW_BARS, chart.bars);
      let bestAvg = Infinity;
      let bestStart = 0;
      for (let start = 0; start + windowSize <= chart.bars; start++) {
        const avg =
          perBarAccuracy.slice(start, start + windowSize).reduce((a, b) => a + b, 0) /
          windowSize;
        if (avg < bestAvg) {
          bestAvg = avg;
          bestStart = start;
        }
      }
      weakBarRange = { start: bestStart + 1, end: bestStart + windowSize };
    }

    let weakestString: { name: string; accuracy: number } | null = null;
    for (const lane of LANE_COLORS) {
      if (laneJudged[lane.lane] === 0) continue;
      const acc = (laneHits[lane.lane] / laneJudged[lane.lane]) * 100;
      if (!weakestString || acc < weakestString.accuracy) {
        weakestString = { name: lane.name, accuracy: acc };
      }
    }

    const best = getPracticeBest(songId);

    return {
      songTitle: song.title,
      artist: song.artist,
      bars: chart.bars,
      bpm: chart.bpm,
      speed,
      runNumber,
      accuracy,
      isNewBest: !best || score > best.score,
      notesHit: hits,
      notesTotal: chart.notes.length,
      bestCombo,
      score,
      meanTimingMs: meanCount > 0 ? meanSum / meanCount : 0,
      barsFailed,
      judgeCounts,
      weakestString,
      perBarAccuracy,
      weakBarRange,
    };
  }, [
    chart,
    phase,
    notes,
    songId,
    song,
    speed,
    runNumber,
    accuracy,
    hits,
    bestCombo,
    score,
    meanSum,
    meanCount,
    judgeCounts,
  ]);

  useEffect(() => {
    if (!runSummaryData) return;
    recordPracticeRun(songId, {
      accuracy: runSummaryData.accuracy,
      score: runSummaryData.score,
      bestCombo: runSummaryData.bestCombo,
    });
  }, [runSummaryData, songId]);

  const currentBar = useMemo(() => {
    if (!chart) return 1;
    let bar = 1;
    for (let i = 0; i < chart.barStartSec.length; i++) {
      if (chart.barStartSec[i] <= t) bar = i + 1;
      else break;
    }
    return bar;
  }, [chart, t]);

  return (
    <div className="dark flex min-h-0 flex-1 flex-col gap-[18px] bg-paper p-[22px] text-ink">
      {phase === "completed" || phase === "failed" ? (
        runSummaryData && (
          <RunSummary
            data={runSummaryData}
            onBackToLibrary={() => router.push("/library")}
            onLoopBars={
              runSummaryData.weakBarRange
                ? () =>
                    router.push(
                      `/player/${songId}?loopStart=${runSummaryData.weakBarRange!.start}&loopEnd=${runSummaryData.weakBarRange!.end}`,
                    )
                : null
            }
            onRunAgain={beginRun}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-rule-strong pb-3">
            <div className="min-w-0">
              <Link
                href="/library"
                className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint transition-colors hover:text-ink"
              >
                <ArrowLeft className="h-3 w-3" />
                Library
              </Link>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
                <h1 className="truncate font-display text-[32px] font-bold leading-none tracking-[-0.025em] text-ink">
                  {song.title}
                </h1>
                <span className="inline-flex h-5 items-center rounded-sm border border-accent px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">
                  {DIFFICULTY_LABEL[song.difficulty]}
                </span>
              </div>
              <p className="mt-1 truncate font-display text-[15px] italic text-ink-muted">
                {song.artist} · Bass, standard tuning
              </p>
            </div>
            <div className="flex items-center gap-[22px]">
              <MetaPair label="Tempo" value={chart ? String(chart.bpm) : undefined} />
              <MetaPair label="Metre" value={chart?.metre} />
              <MetaPair label="Notes" value={chart ? String(chart.notes.length) : undefined} />
              <div className="flex gap-2">
                <PracticeSettingsDialog settings={settings} onChange={updateSettings} icon="keys" />
                <PracticeSettingsDialog settings={settings} onChange={updateSettings} icon="settings" />
              </div>
            </div>
          </div>

          {!chart || !canPlay ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center font-display text-[15px] italic text-ink-muted">
              {chartError ??
                (!hasBacking && chart
                  ? "Rhythm practice needs an imported recording for this song."
                  : "Building the chart from the score…")}
            </div>
          ) : (
            <>
              <PracticeHud
                score={score}
                combo={combo}
                accuracy={accuracy}
                condition={condition}
                bar={currentBar}
                totalBars={chart.bars}
              />
              <NoteHighway
                notes={notes}
                t={t}
                lookaheadSec={settings.noteSpeedSec}
                beatSec={chart.beatSec}
                barStartSec={chart.barStartSec}
                pops={pops}
                flash={flash}
                phase={phase}
                score={score}
                accuracy={accuracy}
                bestCombo={bestCombo}
                keys={settings.keys}
                showFretNumbers={settings.showFretNumbers}
                onPrimaryAction={handlePrimaryAction}
                containerRef={containerRef}
                onFocusSurface={() => containerRef.current?.focus()}
                onFocusChange={(focused) => {
                  hasFocusRef.current = focused;
                }}
              />
              <KeyRow keys={settings.keys} pressed={pressed} />
              <PracticeTransport
                playing={phase === "running"}
                positionSec={t}
                durationSec={chart.durationSec}
                speed={speed}
                onTogglePlay={handlePrimaryAction}
                onRestart={handleRestart}
                onSpeedChange={handleSpeedChange}
              />
            </>
          )}
        </>
      )}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="auto" className="hidden" />
    </div>
  );
}

function MetaPair({ label, value }: { label: string; value?: string }) {
  return (
    <div className="hidden flex-col gap-[3px] md:flex">
      <dt className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">{label}</dt>
      <dd className={value ? "font-mono text-[15px] text-ink" : "font-mono text-[15px] text-ink-ghost"}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
