import { songsterrErrorResponse } from "@/lib/songsterr/errorResponse";
import { convertRevisionToGp7 } from "@/lib/songsterr/gp7";
import { fetchRevisionParts, resolveRevisionMeta } from "@/lib/songsterr/revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** `Nirvana` + `Come As You Are` -> `nirvana-come-as-you-are.gp` */
function gpFileName(artist: string, title: string, songId: number): string {
  const slug = `${artist} ${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || `songsterr-${songId}`}.gp`;
}

function contentDisposition(fileName: string): string {
  return `attachment; filename="${fileName.replace(/["\r\n]/g, "")}"`;
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    const body = (await request.json()) as { url?: unknown; songId?: unknown };
    input = body.url ?? body.songId;
  } catch {
    return jsonError("Expected a JSON body with `url`.", 400);
  }

  if (typeof input === "number") input = String(input);
  if (typeof input !== "string" || !input.trim()) {
    return jsonError("Expected `url` to be a Songsterr link or song ID.", 400);
  }

  try {
    const { meta } = await resolveRevisionMeta(input);
    const { parts, warnings: fetchWarnings } = await fetchRevisionParts(meta);
    const { data, warnings: convertWarnings } = convertRevisionToGp7({ meta, parts });

    const warnings = [...fetchWarnings, ...convertWarnings];
    if (warnings.length > 0) {
      console.warn(
        `[songsterr/download] ${warnings.length} warning(s) for song ${meta.songId} revision ${meta.revisionId}`,
        warnings.slice(0, 10),
      );
    }

    // Copy so the body is ArrayBuffer-backed; TS 5.7+ rejects Uint8Array<ArrayBufferLike>.
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/gp",
        "Content-Length": String(data.byteLength),
        "Content-Disposition": contentDisposition(
          gpFileName(meta.artist, meta.title, meta.songId),
        ),
        "X-Songsterr-Song-Id": String(meta.songId),
        "X-Songsterr-Revision-Id": String(meta.revisionId),
        // Track order in the file, so the client can map a Songsterr track
        // index onto its position even when a part failed to download.
        "X-Songsterr-Part-Ids": parts.map((part) => part.trackMeta.partId).join(","),
      },
    });
  } catch (err) {
    return songsterrErrorResponse(err, "Songsterr tab download failed.");
  }
}
