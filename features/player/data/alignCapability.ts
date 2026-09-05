"use client";

import { useEffect, useState } from "react";

/**
 * What this deployment can do about alignment, asked of the server once.
 *
 * The client cannot infer this: `NODE_ENV` says nothing about whether a
 * production deployment has a GitHub Action wired up, and guessing wrong is
 * exactly the failure that made alignment look broken — a build-time gate meant
 * the request was never sent, so there was no error to see either. The server
 * knows, and `GET /api/align` says.
 */

export type AlignMode = "local" | "dispatch" | "unavailable";

export interface AlignCapability {
  mode: AlignMode;
  /** Why alignment is unavailable, when it is. Shown in the panel. */
  message?: string;
}

const UNKNOWN: AlignCapability = { mode: "unavailable" };

let cached: Promise<AlignCapability> | null = null;

/** Cached for the session; the answer only changes on redeploy. */
export function alignCapability(): Promise<AlignCapability> {
  if (cached) return cached;
  cached = fetch("/api/align")
    .then(async (res) =>
      res.ok
        ? ((await res.json()) as AlignCapability)
        : {
            mode: "unavailable" as const,
            message: `Alignment capability check failed (${res.status}).`,
          },
    )
    .catch((err: Error) => ({
      mode: "unavailable" as const,
      message: `Alignment service unreachable: ${err.message}`,
    }));
  return cached;
}

/** For tests and for a hard refresh after a redeploy. */
export function resetAlignCapability(): void {
  cached = null;
}

/**
 * The capability as React state. Starts unknown and settles after the probe, so
 * a control that depends on it appears rather than flickering away.
 */
export function useAlignCapability(): AlignCapability {
  const [capability, setCapability] = useState<AlignCapability>(UNKNOWN);
  useEffect(() => {
    let cancelled = false;
    void alignCapability().then((next) => {
      if (!cancelled) setCapability(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return capability;
}
