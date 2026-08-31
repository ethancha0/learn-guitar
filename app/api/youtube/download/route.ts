import { readDownloadedAudio, downloadYouTubeAudio } from "@/lib/youtube/download";
import {
  httpStatusForYouTubeError,
  YouTubeToolError,
} from "@/lib/youtube/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function jsonError(
  message: string,
  status: number,
  extra: { code?: string; details?: string } = {},
) {
  return Response.json({ error: message, ...extra }, { status });
}

function errorResponse(err: unknown) {
  if (err instanceof YouTubeToolError) {
    return jsonError(err.message, httpStatusForYouTubeError(err), {
      code: err.code,
      details: err.details,
    });
  }

  return jsonError("YouTube audio download failed.", 500);
}

function contentDisposition(fileName: string): string {
  const safe = fileName.replace(/["\r\n]/g, "");
  return `attachment; filename="${safe}"`;
}

export async function POST(request: Request) {
  let videoId: unknown;
  try {
    const body = (await request.json()) as { videoId?: unknown; url?: unknown };
    videoId = body.videoId ?? body.url;
  } catch {
    return jsonError("Expected a JSON body with `videoId`.", 400);
  }

  if (typeof videoId !== "string") {
    return jsonError("Expected `videoId` to be a YouTube video ID or URL.", 400);
  }

  let audio: Awaited<ReturnType<typeof downloadYouTubeAudio>> | undefined;
  try {
    audio = await downloadYouTubeAudio(videoId);
    const bytes = await readDownloadedAudio(audio);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": audio.contentType,
        "Content-Length": String(audio.sizeBytes),
        "Content-Disposition": contentDisposition(audio.fileName),
        "X-YouTube-Video-Id": audio.videoId,
        "X-Audio-Duration-Sec": String(Math.round(audio.durationSec)),
      },
    });
  } catch (err) {
    return errorResponse(err);
  } finally {
    await audio?.cleanup();
  }
}
