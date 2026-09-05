import { NextResponse } from "next/server";
import { resolveAlignProvider } from "@/lib/align/provider";

/**
 * Queues DTW alignment for one song on GitHub Actions.
 *
 *   POST /api/align/dispatch   { "songId": "..." }
 *
 * Only the id travels: the workflow pulls the tab and recording from Supabase
 * storage itself and writes the finished map back to the song's `sync_map`.
 * That keeps the recording out of this request entirely, which matters — a
 * serverless function has a request body limit well under a typical mp3.
 *
 * The response says only that the run was accepted. The map arrives later, and
 * the player finds it by polling the row (and, failing that, on next open).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const provider = resolveAlignProvider();
  if (provider.kind === "unavailable") {
    return NextResponse.json(
      { status: "failed", stage: "config", message: provider.message },
      { status: 501 },
    );
  }
  if (provider.kind !== "dispatch") {
    return NextResponse.json(
      {
        status: "failed",
        stage: "config",
        message:
          "This deployment aligns in-band. POST the files to /api/align instead.",
      },
      { status: 409 },
    );
  }

  let songId: unknown;
  try {
    ({ songId } = (await request.json()) as { songId?: unknown });
  } catch {
    return NextResponse.json(
      { status: "failed", message: "Expected a JSON body." },
      { status: 400 },
    );
  }
  // The id becomes a storage path segment on the runner, so keep it to the
  // shape the importer actually generates.
  if (typeof songId !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(songId)) {
    return NextResponse.json(
      { status: "failed", message: "`songId` is required." },
      { status: 400 },
    );
  }

  const { repo, token, eventType } = provider.config;
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: { songId },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        stage: "dispatch",
        message: `Could not reach GitHub to queue alignment: ${(err as Error).message}`,
      },
      { status: 502 },
    );
  }

  // 204 is success here; anything else carries a reason worth passing on.
  if (res.status !== 204) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      {
        status: "failed",
        stage: "dispatch",
        message:
          `GitHub refused the alignment run (${res.status}). ` +
          (res.status === 404
            ? "Check ALIGN_GITHUB_REPO and that the token has `contents: write` on it."
            : detail.slice(0, 300)),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ status: "queued", songId }, { status: 202 });
}
