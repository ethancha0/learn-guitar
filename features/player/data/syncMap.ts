/**
 * Score↔audio time mapping.
 *
 * A `SyncMap` is a monotonic, piecewise-linear function between the score
 * timeline (as alphaTab lays it out from the Guitar Pro file) and the recording
 * timeline (`<audio>.currentTime` / `AudioContext.currentTime`). It is the single
 * representation every sync strategy produces:
 *
 *   - the current manual/onset offset  -> `SyncMap.fromOffset(...)`  (2 points)
 *   - an offline DTW alignment          -> `SyncMap.fromPoints(dtwPoints)` (dense)
 *   - later: manual correction anchors   -> `map.withAnchor(...)`
 *
 * Times are **seconds**. The map never moves backward in either direction.
 */

export interface SyncPoint {
  /** Position on the score timeline, seconds. Strictly increasing across a map. */
  scoreTime: number;
  /** Corresponding position in the recording, seconds. Strictly increasing. */
  audioTime: number;
  /** Optional 0..1 alignment confidence for this region (higher = better). */
  confidence?: number;
}

export interface SyncMapDiagnostics {
  method: string;
  /** Mean DTW local cost along the path, if the generator reported it. */
  meanCost?: number;
  maxCost?: number;
  /** Fraction of the path where the local slope stayed within a sane band. */
  pathStability?: number;
  /** Regions the generator flagged as low confidence. */
  suspectRegions?: Array<{ scoreStart: number; scoreEnd: number; reason: string }>;
  [key: string]: unknown;
}

export class SyncMapError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "empty"
      | "too-few"
      | "nan"
      | "score-not-increasing"
      | "audio-not-increasing",
  ) {
    super(message);
    this.name = "SyncMapError";
  }
}

const EPS = 1e-9;
/** Keep the terminal sync point this far inside the media duration (seconds). */
const TERMINAL_EPS = 0.005;

export class SyncMap {
  /** Sorted by `scoreTime`, validated strictly-increasing on both axes. */
  readonly points: readonly SyncPoint[];
  readonly diagnostics?: SyncMapDiagnostics;

  private constructor(points: SyncPoint[], diagnostics?: SyncMapDiagnostics) {
    this.points = points;
    this.diagnostics = diagnostics;
  }

  // --- construction ----------------------------------------------------------

  /**
   * Build from raw points (e.g. a DTW warping path sampled at a fixed step).
   * Points are sorted, de-duplicated, forced strictly monotonic on both axes,
   * then validated. Throws `SyncMapError` for unrecoverable input.
   */
  static fromPoints(
    raw: readonly SyncPoint[],
    diagnostics?: SyncMapDiagnostics,
  ): SyncMap {
    if (!raw || raw.length === 0) {
      throw new SyncMapError("sync map has no points", "empty");
    }
    for (const p of raw) {
      if (!Number.isFinite(p.scoreTime) || !Number.isFinite(p.audioTime)) {
        throw new SyncMapError("sync point contains NaN/Infinity", "nan");
      }
    }

    const sorted = [...raw].sort((a, b) => a.scoreTime - b.scoreTime);

    // Enforce strict monotonicity by nudging; if the input trend is actually
    // decreasing on an axis this will collapse points and fail validation below.
    const cleaned: SyncPoint[] = [];
    for (const p of sorted) {
      const prev = cleaned[cleaned.length - 1];
      if (!prev) {
        cleaned.push({ ...p });
        continue;
      }
      const scoreTime = Math.max(p.scoreTime, prev.scoreTime + EPS);
      const audioTime = Math.max(p.audioTime, prev.audioTime + EPS);
      cleaned.push({ ...p, scoreTime, audioTime });
    }

    if (cleaned.length < 2) {
      throw new SyncMapError("sync map needs at least 2 points", "too-few");
    }

    // Sanity: reject input whose audio axis genuinely trends downward (a sign the
    // two files are different songs). Local DTW jitter is tolerated and cleaned
    // by the monotonic nudge above.
    const netAudio =
      sorted[sorted.length - 1].audioTime - sorted[0].audioTime;
    let downCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].audioTime < sorted[i - 1].audioTime - 1e-3) downCount++;
    }
    if (netAudio <= 0 || downCount > sorted.length * 0.5) {
      throw new SyncMapError(
        "audio timeline decreases across the map",
        "audio-not-increasing",
      );
    }

    return new SyncMap(cleaned, diagnostics);
  }

  /**
   * The current behaviour: a lead-in offset plus one global linear tempo fit
   * across the whole song (identical to alphaTab's single bar-0 flat sync point
   * with the implicit end anchor).
   */
  static fromOffset(
    offsetSec: number,
    scoreDurationSec: number,
    audioDurationSec: number,
  ): SyncMap {
    const audioEnd =
      Number.isFinite(audioDurationSec) && audioDurationSec > offsetSec + EPS
        ? // Strictly inside the media, so alphaTab's tail branch never hits 0/0.
          audioDurationSec - TERMINAL_EPS
        : offsetSec + Math.max(scoreDurationSec, EPS);
    return new SyncMap(
      [
        { scoreTime: 0, audioTime: Math.max(0, offsetSec) },
        { scoreTime: Math.max(scoreDurationSec, EPS), audioTime: audioEnd },
      ],
      { method: "offset" },
    );
  }

  /** A pure constant offset (slope 1). Used when only the lead-in is known. */
  static fromConstantOffset(offsetSec: number, spanSec = 600): SyncMap {
    return new SyncMap(
      [
        { scoreTime: 0, audioTime: Math.max(0, offsetSec) },
        { scoreTime: spanSec, audioTime: Math.max(0, offsetSec) + spanSec },
      ],
      { method: "constant-offset" },
    );
  }

  // --- mapping -------------------------------------------------------------

  scoreTimeToAudioTime(scoreTime: number): number {
    return this.interp(scoreTime, "score");
  }

  audioTimeToScoreTime(audioTime: number): number {
    return this.interp(audioTime, "audio");
  }

  /** Local playback-rate ratio d(audioTime)/d(scoreTime) at a score position. */
  slopeAtScoreTime(scoreTime: number): number {
    const i = this.segmentIndex(scoreTime, "score");
    const a = this.points[i];
    const b = this.points[i + 1];
    return (b.audioTime - a.audioTime) / (b.scoreTime - a.scoreTime);
  }

  private interp(x: number, axis: "score" | "audio"): number {
    const inKey = axis === "score" ? "scoreTime" : "audioTime";
    const outKey = axis === "score" ? "audioTime" : "scoreTime";
    const i = this.segmentIndex(x, axis);
    const a = this.points[i];
    const b = this.points[i + 1];
    const t = (x - a[inKey]) / (b[inKey] - a[inKey]);
    const y = a[outKey] + t * (b[outKey] - a[outKey]);
    // Clamp so the timeline can never run negative.
    return Math.max(0, y);
  }

  /** Index of the segment [i, i+1] to use for value `x` on the given axis. */
  private segmentIndex(x: number, axis: "score" | "audio"): number {
    const key = axis === "score" ? "scoreTime" : "audioTime";
    const pts = this.points;
    if (x <= pts[0][key]) return 0;
    if (x >= pts[pts.length - 1][key]) return pts.length - 2;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][key] <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // --- transforms -------------------------------------------------------------

  /** Resample to a uniform grid on the score axis (stable frontend payload). */
  resample(stepSec: number): SyncPoint[] {
    const start = this.points[0].scoreTime;
    const end = this.points[this.points.length - 1].scoreTime;
    const out: SyncPoint[] = [];
    for (let s = start; s < end - EPS; s += stepSec) {
      out.push({
        scoreTime: s,
        audioTime: this.scoreTimeToAudioTime(s),
        confidence: this.confidenceAtScoreTime(s),
      });
    }
    out.push({
      scoreTime: end,
      audioTime: this.scoreTimeToAudioTime(end),
      confidence: this.confidenceAtScoreTime(end),
    });
    return out;
  }

  /**
   * Isotonic (pool-adjacent-violators) smoothing of the audio axis plus an
   * optional slope clamp, so a noisy DTW path becomes a stable monotone curve.
   */
  smoothed(opts: { maxSlope?: number; minSlope?: number } = {}): SyncMap {
    const minSlope = opts.minSlope ?? 0.2;
    const maxSlope = opts.maxSlope ?? 5;
    const xs = this.points.map((p) => p.scoreTime);
    const ys = this.points.map((p) => p.audioTime);

    // PAVA on ys (already sorted by xs).
    const w = ys.map(() => 1);
    const v = [...ys];
    for (let i = 1; i < v.length; ) {
      if (v[i] < v[i - 1]) {
        const merged = (v[i - 1] * w[i - 1] + v[i] * w[i]) / (w[i - 1] + w[i]);
        v[i - 1] = merged;
        w[i - 1] += w[i];
        v.splice(i, 1);
        w.splice(i, 1);
        xs.splice(i, 1);
        if (i > 1) i--;
      } else {
        i++;
      }
    }

    // Rebuild dense points, clamping local slope.
    const pts: SyncPoint[] = [{ scoreTime: xs[0], audioTime: v[0] }];
    for (let i = 1; i < xs.length; i++) {
      const dx = xs[i] - xs[i - 1];
      let slope = (v[i] - v[i - 1]) / dx;
      slope = Math.min(maxSlope, Math.max(minSlope, slope));
      pts.push({
        scoreTime: xs[i],
        audioTime: pts[i - 1].audioTime + slope * dx,
      });
    }
    return new SyncMap(pts, {
      ...(this.diagnostics ?? { method: "unknown" }),
      method: `${this.diagnostics?.method ?? "unknown"}+smoothed`,
    });
  }

  /**
   * Insert a manual correction anchor and locally re-fit the surrounding region
   * so the curve passes through it while staying monotone. Points strictly
   * between the two neighbouring anchors are dropped and replaced by straight
   * segments to `(scoreTime, audioTime)`.
   */
  withAnchor(scoreTime: number, audioTime: number): SyncMap {
    const kept = this.points.filter(
      (p) => p.scoreTime < scoreTime - 1e-3 || p.scoreTime > scoreTime + 1e-3,
    );
    const merged = [...kept, { scoreTime, audioTime, confidence: 1 }].sort(
      (a, b) => a.scoreTime - b.scoreTime,
    );
    return SyncMap.fromPoints(merged, {
      ...(this.diagnostics ?? { method: "unknown" }),
      method: `${this.diagnostics?.method ?? "unknown"}+anchor`,
    });
  }

  /** Apply a list of manual anchors in order. */
  withAnchors(anchors: readonly { scoreTime: number; audioTime: number }[]): SyncMap {
    let map: SyncMap = this;
    for (const a of [...anchors].sort((x, y) => x.scoreTime - y.scoreTime)) {
      map = map.withAnchor(a.scoreTime, a.audioTime);
    }
    return map;
  }

  /**
   * Guarantee the curve is defined all the way to `scoreEndSec`.
   *
   * alphaTab's final segment is NOT bounded by our last sync point: it
   * interpolates from the last point to `backingTrackDuration` (whatever our
   * media handler reports) and maps that onto the score end. So any error in the
   * reported MP3 duration — or any outro present in the recording but absent
   * from the tab — becomes end-of-song drift. Appending an explicit terminal
   * point makes that branch degenerate for the whole musical part of the song.
   *
   * The terminal audio time is extrapolated with the final local slope, so a
   * long unnotated outro is left *outside* the mapping instead of stretching it.
   */
  withTerminalAnchor(scoreEndSec: number, audioDurationSec?: number): SyncMap {
    const last = this.points[this.points.length - 1];
    if (scoreEndSec <= last.scoreTime + 1e-3) return this;

    // Extrapolate on the map's *typical* slope, not the final segment. DTW paths
    // routinely end with a near-vertical run (the synthesized decay tail matching
    // the recording's outro); using it would fling the terminal point seconds
    // past the end of the song.
    const slope = this.medianSlope();
    let audioEnd = last.audioTime + (scoreEndSec - last.scoreTime) * slope;
    if (
      audioDurationSec != null &&
      Number.isFinite(audioDurationSec) &&
      audioDurationSec > last.audioTime + 1e-3
    ) {
      // Stay strictly inside the media: alphaTab's tail branch divides by
      // (backingTrackDuration − lastSyncTime), which is 0/0 → NaN if our last
      // point sits exactly on the duration.
      audioEnd = Math.min(audioEnd, audioDurationSec - TERMINAL_EPS);
    }
    if (audioEnd <= last.audioTime + 1e-3) return this;

    return new SyncMap(
      [...this.points, { scoreTime: scoreEndSec, audioTime: audioEnd }],
      this.diagnostics,
    );
  }

  /** Median local slope — a robust stand-in for the song's tempo ratio. */
  medianSlope(): number {
    const slopes: number[] = [];
    for (let i = 1; i < this.points.length; i++) {
      const dx = this.points[i].scoreTime - this.points[i - 1].scoreTime;
      if (dx > EPS) {
        slopes.push((this.points[i].audioTime - this.points[i - 1].audioTime) / dx);
      }
    }
    if (slopes.length === 0) return 1;
    slopes.sort((a, b) => a - b);
    return slopes[Math.floor(slopes.length / 2)];
  }

  /**
   * Enforce the invariants that keep the END of the song honest, whatever
   * produced the points (DTW, an older pipeline, hand-edited storage):
   *
   *  1. Trailing DTW **end-effects** are dropped. A warping path often finishes
   *     with a near-vertical run — the reference render's decay tail matching the
   *     recording's outro — so audio races ahead while the score barely moves.
   *  2. No point may map past the recording. alphaTab would otherwise ask the
   *     media to seek beyond its own duration and the cursor would still be
   *     mid-score when playback stops.
   *  3. The curve reaches the score end, extrapolated on the median slope.
   *
   * This is deliberately independent of `withTerminalAnchor`, which trusts an
   * existing terminal point; here nothing is trusted.
   */
  sanitize(opts: {
    scoreEndSec?: number;
    audioDurationSec?: number;
    /** Local slope beyond this multiple of the median is treated as a defect. */
    maxSlopeFactor?: number;
  }): { map: SyncMap; repairs: string[] } {
    const maxFactor = opts.maxSlopeFactor ?? 3;
    const repairs: string[] = [];
    const median = this.medianSlope();
    let pts = [...this.points];

    // 1. Trim a degenerate tail (keep at least two points).
    let trimmed = 0;
    while (pts.length > 2) {
      const dx = pts[pts.length - 1].scoreTime - pts[pts.length - 2].scoreTime;
      if (dx <= EPS) break;
      const slope =
        (pts[pts.length - 1].audioTime - pts[pts.length - 2].audioTime) / dx;
      if (slope <= median * maxFactor) break;
      pts.pop();
      trimmed++;
    }
    if (trimmed > 0) {
      repairs.push(
        `trimmed ${trimmed} end-effect point(s) whose slope exceeded ${maxFactor}× the median (${median.toFixed(3)}×)`,
      );
    }

    // 2. Clamp inside the recording.
    const audioMax =
      opts.audioDurationSec != null && Number.isFinite(opts.audioDurationSec)
        ? opts.audioDurationSec - TERMINAL_EPS
        : undefined;
    if (audioMax != null) {
      const over = pts.filter((p) => p.audioTime > audioMax);
      if (over.length > 0) {
        pts = pts.filter((p) => p.audioTime <= audioMax);
        repairs.push(
          `dropped ${over.length} point(s) mapping past the recording (${opts.audioDurationSec!.toFixed(2)}s)`,
        );
      }
    }

    if (pts.length < 2) {
      // Nothing survived; fall back to a plain offset line.
      const offset = this.points[0].audioTime - this.points[0].scoreTime;
      repairs.push("map collapsed after repair; fell back to a constant offset");
      return {
        map: SyncMap.fromConstantOffset(Math.max(0, offset)),
        repairs,
      };
    }

    let map = new SyncMap(pts, this.diagnostics);

    // 3. Reach the score end on a sane slope.
    if (opts.scoreEndSec != null && opts.scoreEndSec > 0) {
      const before = map.points[map.points.length - 1].scoreTime;
      map = map.withTerminalAnchor(opts.scoreEndSec, opts.audioDurationSec);
      if (map.points[map.points.length - 1].scoreTime > before + 1e-3) {
        repairs.push(
          `extended the curve to the score end (${opts.scoreEndSec.toFixed(2)}s) on the median slope`,
        );
      }
    }

    return { map, repairs };
  }

  /**
   * Douglas–Peucker simplification of the warp curve.
   *
   * A 1 s DTW grid over a 4-minute song is ~240 points, and every one becomes a
   * tempo change for alphaTab. Frame-level jitter then reads as noisy local
   * tempo. Simplifying keeps only the vertices needed to stay within
   * `toleranceSec` of the original curve, so genuine tempo moves survive and
   * redundant collinear runs collapse. Keep the dense map for scoring.
   */
  simplify(toleranceSec = 0.02): SyncMap {
    const pts = this.points;
    if (pts.length <= 2) return this;

    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;

    // Iterative DP to avoid recursion limits on very long songs.
    const stack: Array<[number, number]> = [[0, pts.length - 1]];
    while (stack.length) {
      const [lo, hi] = stack.pop()!;
      if (hi <= lo + 1) continue;
      const a = pts[lo];
      const b = pts[hi];
      const dx = b.scoreTime - a.scoreTime;
      const slope = dx > EPS ? (b.audioTime - a.audioTime) / dx : 0;
      let worst = -1;
      let worstDev = toleranceSec;
      for (let i = lo + 1; i < hi; i++) {
        const predicted = a.audioTime + (pts[i].scoreTime - a.scoreTime) * slope;
        const dev = Math.abs(pts[i].audioTime - predicted);
        if (dev > worstDev) {
          worstDev = dev;
          worst = i;
        }
      }
      if (worst >= 0) {
        keep[worst] = 1;
        stack.push([lo, worst], [worst, hi]);
      }
    }

    const simplified = pts.filter((_, i) => keep[i] === 1);
    if (simplified.length === pts.length) return this;
    return new SyncMap([...simplified], {
      ...(this.diagnostics ?? { method: "unknown" }),
      simplifiedFrom: pts.length,
      simplifyToleranceSec: toleranceSec,
    });
  }

  confidenceAtScoreTime(scoreTime: number): number | undefined {
    const i = this.segmentIndex(scoreTime, "score");
    const a = this.points[i].confidence;
    const b = this.points[i + 1].confidence;
    if (a == null && b == null) return undefined;
    return Math.min(a ?? 1, b ?? 1);
  }

  get scoreDuration(): number {
    return this.points[this.points.length - 1].scoreTime;
  }
  get audioDuration(): number {
    return this.points[this.points.length - 1].audioTime;
  }
}

// --- alphaTab bridge ---------------------------------------------------------

/** Bar index -> score-time of the bar's start (seconds), from alphaTab. */
export interface BarTimeline {
  bars: Array<{ barIndex: number; startSec: number }>;
  /** Score end time in seconds. */
  endSec: number;
}

export interface AlphaTabFlatSyncPoint {
  barIndex: number;
  barPosition: number;
  barOccurence: number;
  millisecondOffset: number;
}

/**
 * Convert a `SyncMap` into alphaTab `FlatSyncPoint`s (fed to
 * `score.applyFlatSyncPoints`). alphaTab then interpolates piecewise-linearly
 * between them exactly like `SyncMap` does, so the visible cursor follows the
 * same mapping the gameplay clock uses.
 *
 * Points are placed on first repeat occurrences only (`barOccurence: 0`);
 * repeat-aware alignment is a follow-up.
 */
export function toAlphaTabFlatSyncPoints(
  map: SyncMap,
  timeline: BarTimeline,
  stepSec?: number,
): AlphaTabFlatSyncPoint[] {
  const bars = timeline.bars;
  if (bars.length === 0) return [];

  const barStartSec = (i: number) =>
    i < bars.length ? bars[i].startSec : timeline.endSec;

  const out: AlphaTabFlatSyncPoint[] = [];
  // Default: use the map's own vertices. They already encode exactly where the
  // curve bends (see `SyncMap.simplify`), so a fixed grid would only add
  // redundant tempo changes. `stepSec` forces a uniform grid when a caller
  // explicitly wants one.
  const samples = stepSec ? map.resample(stepSec) : [...map.points];
  let barCursor = 0;
  for (const s of samples) {
    while (
      barCursor + 1 < bars.length &&
      barStartSec(barCursor + 1) <= s.scoreTime + EPS
    ) {
      barCursor++;
    }
    const start = barStartSec(barCursor);
    const nextStart = barStartSec(barCursor + 1);
    const span = Math.max(nextStart - start, EPS);
    const barPosition = Math.min(1, Math.max(0, (s.scoreTime - start) / span));
    const prev = out[out.length - 1];
    // alphaTab wants strictly increasing (barIndex, barPosition).
    if (
      prev &&
      prev.barIndex === bars[barCursor].barIndex &&
      barPosition <= prev.barPosition
    ) {
      continue;
    }
    out.push({
      barIndex: bars[barCursor].barIndex,
      barPosition,
      barOccurence: 0,
      millisecondOffset: Math.round(s.audioTime * 1000),
    });
  }
  return out;
}

/**
 * Emit one `FlatSyncPoint` per bar downbeat (plus score end), interpolated
 * through the warp curve. Preferred for DTW maps: musically meaningful vertices
 * without hundreds of arbitrary 1 s grid points.
 */
export function toAlphaTabBarSyncPoints(
  map: SyncMap,
  timeline: BarTimeline,
): AlphaTabFlatSyncPoint[] {
  const bars = timeline.bars;
  if (bars.length === 0) return [];

  const samples: SyncPoint[] = bars.map((b) => ({
    scoreTime: b.startSec,
    audioTime: map.scoreTimeToAudioTime(b.startSec),
  }));

  const endSec = timeline.endSec;
  const last = samples[samples.length - 1];
  if (endSec > last.scoreTime + EPS) {
    samples.push({
      scoreTime: endSec,
      audioTime: map.scoreTimeToAudioTime(endSec),
    });
  }

  const barTimeline: BarTimeline = {
    bars: bars.map((b) => ({ barIndex: b.barIndex, startSec: b.startSec })),
    endSec,
  };
  return toAlphaTabFlatSyncPoints(
    SyncMap.fromPoints(samples, map.diagnostics),
    barTimeline,
  );
}
