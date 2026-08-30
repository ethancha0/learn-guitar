"use client";

import { useCallback, useState } from "react";
import { Anchor, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  patchAudioSync,
  removeSyncAnchor,
  setSyncAnchors,
  upsertSyncAnchor,
  type SyncAnchor,
  type StoredSyncMap,
} from "@/features/library/data/songStore";
import { DtwSyncGenerator } from "@/features/player/data/syncGenerator";
import { base64ToBytes } from "@/features/library/data/tabFile";
import { nearestOnset, type OnsetEnvelope } from "@/features/player/data/onsetDetect";
import type { ScoreTimeline } from "@/features/player/data/scoreTimeline";
import type { SyncMap } from "@/features/player/data/syncMap";

interface SyncAnchorEditorProps {
  songId: string;
  tabData?: string;
  audioBlob: Blob | null;
  timeline: ScoreTimeline;
  syncMap: SyncMap | null;
  anchors: SyncAnchor[];
  posSec: number;
  onsetEnv: OnsetEnvelope | null;
  selectedScoreTime: number | null;
  onAnchorsChange: () => void;
  onSelectScoreTime: (scoreTime: number | null) => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function SyncAnchorEditor({
  songId,
  tabData,
  audioBlob,
  timeline,
  syncMap,
  anchors,
  posSec,
  onsetEnv,
  selectedScoreTime,
  onAnchorsChange,
  onSelectScoreTime,
}: SyncAnchorEditorProps) {
  const [dtwRunning, setDtwRunning] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [draftAnchors, setDraftAnchors] = useState<SyncAnchor[] | null>(null);

  const displayAnchors = draftAnchors ?? anchors;

  const placeAnchorAtPlayhead = useCallback(() => {
    if (!syncMap || selectedScoreTime == null) return;
    const audioTime = posSec;
    upsertSyncAnchor(songId, {
      scoreTime: selectedScoreTime,
      audioTime,
      label: `bar @ ${fmt(selectedScoreTime)}`,
    });
    onAnchorsChange();
    setMessage(`Anchor at score ${fmt(selectedScoreTime)} → audio ${fmt(audioTime)}`);
  }, [songId, syncMap, selectedScoreTime, posSec, onAnchorsChange]);

  const handleDelete = (scoreTime: number) => {
    removeSyncAnchor(songId, scoreTime);
    onAnchorsChange();
  };

  const handleRunDtw = async () => {
    if (!tabData || !audioBlob || !timeline) return;
    setDtwRunning(true);
    setMessage(undefined);
    try {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await audioBlob.arrayBuffer());
      await ctx.close();

      const gen = new DtwSyncGenerator();
      const data = await gen.generate({
        songId,
        gpBytes: base64ToBytes(tabData),
        audioBlob,
        scoreDurationSec: timeline.endSec,
        audioDurationSec: buf.duration,
        anchors: anchors.map((a) => ({
          scoreTime: a.scoreTime,
          audioTime: a.audioTime,
        })),
      });
      if (data.status === "failed" || data.points.length < 2) {
        setMessage(data.message ?? "DTW alignment failed.");
        return;
      }
      const stored: StoredSyncMap = {
        points: data.points,
        anchors,
        method: data.method,
        status: data.status === "low-confidence" ? "low-confidence" : "ok",
        scoreEndSec: timeline.endSec,
        audioDurationSec: buf.duration,
        diagnostics: data.diagnostics,
        createdAt: Date.now(),
      };
      patchAudioSync(songId, { syncMap: stored, offsetMs: 0 });
      onAnchorsChange();
      setMessage(data.message ?? "DTW alignment complete.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setDtwRunning(false);
    }
  };

  const suggestAnchors = () => {
    const regions = syncMap?.diagnostics?.suspectRegions;
    if (!regions?.length || !onsetEnv) {
      setMessage("No suspect regions to suggest anchors from.");
      return;
    }
    const suggested: SyncAnchor[] = [];
    for (const r of regions) {
      const mid = (r.scoreStart + r.scoreEnd) / 2;
      const bar = timeline.bars.find(
        (b) => b.scoreTimeSec >= mid - 0.01,
      );
      const scoreTime = bar?.scoreTimeSec ?? mid;
      const predicted = syncMap!.scoreTimeToAudioTime(scoreTime);
      const hit = nearestOnset(onsetEnv, predicted, 0.35);
      suggested.push({
        scoreTime,
        audioTime: hit.found ? hit.onsetSec : predicted,
        label: `suggested @ ${fmt(scoreTime)}`,
      });
    }
    setDraftAnchors(suggested);
    setMessage(
      `${suggested.length} draft anchor(s) — review and click Accept, or edit individually.`,
    );
  };

  const acceptDraft = () => {
    if (!draftAnchors?.length) return;
    setSyncAnchors(songId, draftAnchors);
    setDraftAnchors(null);
    onAnchorsChange();
    setMessage("Draft anchors saved.");
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
          <Anchor className="h-4 w-4 text-accent" />
          Manual anchors
        </h2>
        <span className="text-[11px] text-zinc-500">
          {displayAnchors.length} anchor{displayAnchors.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-zinc-500">
        Select a bar below, then click the waveform or histogram to place an
        anchor. Shift+click snaps to the nearest onset peak. Anchors apply
        instantly without re-running DTW.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {timeline.bars.map((b) => (
          <button
            key={b.barIndex}
            type="button"
            onClick={() =>
              onSelectScoreTime(
                selectedScoreTime === b.scoreTimeSec ? null : b.scoreTimeSec,
              )
            }
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
              selectedScoreTime === b.scoreTimeSec
                ? "bg-accent/20 text-accent"
                : "bg-surface text-zinc-400 hover:text-zinc-200",
            )}
          >
            {b.barIndex + 1}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={selectedScoreTime == null}
          onClick={placeAnchorAtPlayhead}
        >
          <Plus className="h-3.5 w-3.5" />
          Anchor at playhead
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={suggestAnchors}
          disabled={!syncMap?.diagnostics?.suspectRegions?.length}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Suggest anchors
        </Button>
        {draftAnchors && (
          <Button size="sm" onClick={acceptDraft}>
            Accept draft
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunDtw}
          disabled={dtwRunning || !tabData || !audioBlob}
        >
          {dtwRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Re-run DTW
        </Button>
      </div>

      {displayAnchors.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-2">Score</th>
              <th className="py-1 pr-2">Audio</th>
              <th className="py-1 pr-2">Label</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="tabular-nums text-zinc-300">
            {displayAnchors.map((a) => (
              <tr key={a.scoreTime} className="border-t border-white/5">
                <td className="py-1 pr-2">{fmt(a.scoreTime)}</td>
                <td className="py-1 pr-2">{fmt(a.audioTime)}</td>
                <td className="py-1 pr-2 text-zinc-500">{a.label ?? "—"}</td>
                <td className="py-1 text-right">
                  {!draftAnchors && (
                    <button
                      type="button"
                      aria-label="Delete anchor"
                      onClick={() => handleDelete(a.scoreTime)}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message && (
        <p className="text-[11px] leading-snug text-zinc-400">{message}</p>
      )}
    </div>
  );
}
