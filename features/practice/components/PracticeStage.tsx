"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft } from "lucide-react";
import { Button, engagedKey } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { Song } from "@/features/library/types/song";
import {
  AUDIO_SYNC_EVENT,
  AUDIO_SYNC_KEY,
  getAudioSync,
  patchAudioSync,
  type AudioSyncSettings,
  type StoredSyncMap,
} from "@/features/library/data/songStore";
import { base64ToBytes } from "@/features/library/data/tabFile";
import { AudioOffsetControl } from "@/features/player/components/AudioOffsetControl";
import { SyncDiagnostics } from "@/features/player/components/SyncDiagnostics";
import { queueAlignment, useAlignmentJob } from "@/features/player/data/alignmentQueue";
import { getBackingAudio } from "@/features/player/data/audioStore";
import { buildPlaybackSyncMap } from "@/features/player/data/buildSyncMap";
import { AudioClock } from "@/features/player/data/audioClock";
import { getAudioContext, unlockAudio } from "@/features/player/data/audioEngine";
import { OffsetSyncGenerator } from "@/features/player/data/syncGenerator";
import { useSyncDiagnosticsEnabled } from "@/features/player/data/syncDiagnosticsFlag";
import type { SyncMap } from "@/features/player/data/syncMap";
import { buildChart, pickBassTrackIndex, UnsupportedTrackError } from "../data/buildChart";
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
import { JudgementFlashOverlay } from "./JudgementFlashOverlay";
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
const OFFSET_CLAMP_MS = 5000;
const SYNC_PERSIST_DEBOUNCE_MS = 400;

const SYNC_SOURCE_LABEL: Record<"dtw" | "offset" | "none", string> = {
  dtw: "DTW aligned",
  offset: "Linear offset",
  none: "Not synced",
};

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

  // --- chart -----------------------------------------------------------------
  const [chart, setChart] = useState<PracticeChart | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChart(null);
    setChartError(null);
    const bytes = base64ToBytes(tabData);
    // Practice mode plays whichever track actually reads as the bass part,
    // not whatever track the score player happens to be showing — a song's
    // default track is very often a guitar or vocal part, and picking that
    // blindly rejected the song even when a perfectly good bass track sat
    // right next to it in the same file.
    pickBassTrackIndex(bytes)
      .then((bassIndex) => {
        if (cancelled) return null;
        if (bassIndex === null) {
          setChartError("This song has no 4-string bass track to practice.");
          return null;
        }
        return buildChart(bytes, bassIndex);
      })
      .then((c) => {
        if (!cancelled && c) setChart(c);
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
  }, [tabData]);

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

  // --- sync settings (offset / DTW map) -----------------------------------------
  //
  // The same persisted settings the score player reads and writes
  // (`getAudioSync` / `patchAudioSync`), so DTW alignment run from an import or
  // from the player carries straight over here, and an offset nudge made in
  // practice mode is visible back in the player too.
  const [offsetMs, setOffsetMs] = useState(0);
  const [storedSyncMap, setStoredSyncMap] = useState<StoredSyncMap | null>(null);
  const [dtwStatus, setDtwStatus] = useState<AudioSyncSettings["dtwStatus"]>();
  const [syncSettingsLoaded, setSyncSettingsLoaded] = useState(false);
  const [autoAligning, setAutoAligning] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | undefined>();
  const selfWritingSyncRef = useRef(false);
  const offsetPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSyncSettingsLoaded(false);
    const sync = getAudioSync(songId);
    setOffsetMs(sync?.offsetMs ?? 0);
    setStoredSyncMap(sync?.syncMap ?? null);
    setDtwStatus(sync?.dtwStatus);
    setSyncSettingsLoaded(true);
  }, [songId]);

  // The sync-debug page and the score player write to the same store — reload
  // whenever a DTW run lands or an offset/anchor changes elsewhere, so a chart
  // already open here picks up the real alignment instead of the offset
  // fallback it may have started with.
  useEffect(() => {
    const reload = () => {
      if (selfWritingSyncRef.current) return;
      const sync = getAudioSync(songId);
      setOffsetMs(sync?.offsetMs ?? 0);
      setStoredSyncMap(sync?.syncMap ?? null);
      setDtwStatus(sync?.dtwStatus);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== AUDIO_SYNC_KEY) return;
      reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUDIO_SYNC_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUDIO_SYNC_EVENT, reload);
    };
  }, [songId]);

  const persistSync = useCallback(
    (patch: Partial<AudioSyncSettings>) => {
      selfWritingSyncRef.current = true;
      try {
        patchAudioSync(songId, patch);
      } finally {
        selfWritingSyncRef.current = false;
      }
    },
    [songId],
  );

  const { syncMap, syncSource, syncWarning, anchors } = useMemo(() => {
    if (!chart) {
      return { syncMap: null, syncSource: "none" as const, syncWarning: undefined, anchors: [] };
    }
    return buildPlaybackSyncMap({
      stored: storedSyncMap,
      offsetMs,
      scoreEndSec: chart.durationSec,
      audioDurationSec,
    });
  }, [chart, storedSyncMap, offsetMs, audioDurationSec]);
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

  // A song whose DTW mapping is still being solved isn't ready to practice
  // against — the highway would track a straight-line guess and then jump
  // when the real alignment lands mid-run, same as the player's own guard.
  const waitingForAlignment = dtwStatus === "pending" || dtwStatus === "queued";
  const canPlay =
    hasBacking && syncMap != null && syncSettingsLoaded && !waitingForAlignment;

  const handleOffsetChange = useCallback(
    (nextMs: number) => {
      const clamped = Math.max(-OFFSET_CLAMP_MS, Math.min(OFFSET_CLAMP_MS, Math.round(nextMs)));
      const deltaSec = (clamped - offsetMs) / 1000;
      setOffsetMs(clamped);

      // A nudge on top of a DTW map slides the whole curve (points and
      // anchors together) so manual trim still works over the real alignment.
      let nextMap = storedSyncMap;
      if (storedSyncMap && deltaSec !== 0) {
        nextMap = {
          ...storedSyncMap,
          points: storedSyncMap.points.map((p) => ({
            ...p,
            audioTime: Math.max(0, p.audioTime + deltaSec),
          })),
          anchors: storedSyncMap.anchors?.map((a) => ({
            ...a,
            audioTime: Math.max(0, a.audioTime + deltaSec),
          })),
        };
        setStoredSyncMap(nextMap);
      }

      if (offsetPersistTimer.current) clearTimeout(offsetPersistTimer.current);
      offsetPersistTimer.current = setTimeout(() => {
        persistSync({ offsetMs: clamped, ...(nextMap ? { syncMap: nextMap } : {}) });
      }, SYNC_PERSIST_DEBOUNCE_MS);
    },
    [offsetMs, storedSyncMap, persistSync],
  );

  const handleOffsetReset = useCallback(() => {
    setStoredSyncMap(null);
    setOffsetMs(0);
    setSyncMessage(undefined);
    persistSync({ offsetMs: 0, syncMap: undefined });
  }, [persistSync]);

  /** Fast in-browser alignment: first-onset offset + global linear fit. */
  const handleAutoAlign = useCallback(async () => {
    setAutoAligning(true);
    setSyncMessage(undefined);
    try {
      const blob = await getBackingAudio(songId);
      if (!blob) return;
      const result = await new OffsetSyncGenerator().generate({
        songId,
        gpBytes: base64ToBytes(tabData),
        audioBlob: blob,
        scoreDurationSec: chart?.durationSec ?? 0,
        audioDurationSec,
      });
      const offsetSec = (result.diagnostics?.offsetSec as number | undefined) ?? 0;
      setStoredSyncMap(null);
      handleOffsetChange(Math.round(offsetSec * 1000));
      if (result.status === "low-confidence") setSyncMessage(result.message);
    } finally {
      setAutoAligning(false);
    }
  }, [songId, tabData, chart, audioDurationSec, handleOffsetChange]);

  /**
   * Re-run offline DTW alignment via the shared queue — the same path a
   * background job started at import time takes. The result lands in the
   * `learn-bass.audio-sync` store, which the reload effect above picks up
   * live, so the diagnostics panel updates the moment it finishes without a
   * page reload.
   */
  const handleDtwAlign = useCallback(async () => {
    setSyncMessage(undefined);
    const blob = await getBackingAudio(songId);
    if (!blob) {
      setSyncMessage("No recording to align against.");
      return;
    }
    await queueAlignment({
      songId,
      gpBytes: base64ToBytes(tabData),
      audioBlob: blob,
      scoreDurationSec: chart?.durationSec ?? 0,
      audioDurationSec,
      anchors: storedSyncMap?.anchors ?? [],
      force: true,
    });
  }, [songId, tabData, chart, audioDurationSec, storedSyncMap]);

  // Alignment runs in a shared queue, so a job started elsewhere (e.g. the
  // import dialog, or the player in another tab) before this page mounted
  // shows up here too.
  const alignmentJob = useAlignmentJob(songId);
  const dtwRunning =
    alignmentJob?.state === "queued" || alignmentJob?.state === "running";
  useEffect(() => {
    if (alignmentJob?.message) setSyncMessage(alignmentJob.message);
  }, [alignmentJob]);

  // --- sync diagnostics panel --------------------------------------------------
  const diagEnabled = useSyncDiagnosticsEnabled();
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (offsetPersistTimer.current) clearTimeout(offsetPersistTimer.current);
    };
  }, []);

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
                {diagEnabled && hasBacking && (
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={dtwRunning ? "Aligning… (sync diagnostics)" : "Sync diagnostics"}
                    title="Sync diagnostics (DTW map, offset, drift)"
                    aria-pressed={diagOpen}
                    className={cn((diagOpen || dtwRunning) && engagedKey)}
                    onClick={() => setDiagOpen((o) => !o)}
                  >
                    <Activity className={cn("h-4 w-4", dtwRunning && "animate-pulse")} />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {!chart || !canPlay ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center font-display text-[15px] italic text-ink-muted">
              {chartError ??
                (!hasBacking && chart
                  ? "Rhythm practice needs an imported recording for this song."
                  : chart && waitingForAlignment
                    ? "Preparing synced playback — aligning the tab to the recording…"
                    : "Building the chart from the score…")}
            </div>
          ) : (
            <>
              <div className="relative mx-auto flex w-full max-w-[1240px] flex-col gap-[18px]">
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
                <JudgementFlashOverlay flash={flash} t={t} />
              </div>
              <PracticeTransport
                playing={phase === "running"}
                positionSec={t}
                durationSec={chart.durationSec}
                speed={speed}
                onTogglePlay={handlePrimaryAction}
                onRestart={handleRestart}
                onSpeedChange={handleSpeedChange}
              />
              {hasBacking && (
                <div className="flex flex-wrap items-center gap-2 border border-rule-strong bg-paper-raised px-4 py-2.5">
                  <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
                    Sync
                  </span>
                  <span className="font-mono text-xs text-ink-muted">
                    {SYNC_SOURCE_LABEL[syncSource]}
                  </span>
                  <span aria-hidden className="mx-1 h-5 w-px bg-dot" />
                  <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
                    Offset
                  </span>
                  <AudioOffsetControl
                    compact
                    offsetMs={offsetMs}
                    onChange={handleOffsetChange}
                    onReset={handleOffsetReset}
                    onAutoAlign={handleAutoAlign}
                    autoAligning={autoAligning}
                    disabled={!syncSettingsLoaded}
                  />
                  {syncMessage && (
                    <span className="font-mono text-[10px] text-accent">{syncMessage}</span>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {diagEnabled && diagOpen && (
        <SyncDiagnostics
          songId={songId}
          map={syncMap}
          method={syncMap?.diagnostics?.method ?? "offset"}
          syncSource={syncSource}
          syncWarning={syncWarning}
          scoreDurationSec={chart?.durationSec ?? 0}
          audioDurationSec={audioDurationSec}
          appliedPointCount={syncMap?.points.length ?? 0}
          scoreTimeSec={t}
          audioTimeSec={audioRef.current?.currentTime ?? 0}
          anchors={anchors}
          onVerifyTransfer={() => ({
            error:
              "Practice mode reads the sync map directly for its game clock — there's no alphaTab hand-off to verify here. The curve and live error above are the real check.",
          })}
          onRunDtw={handleDtwAlign}
          dtwRunning={dtwRunning}
          message={syncMessage}
          onClose={() => setDiagOpen(false)}
        />
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
