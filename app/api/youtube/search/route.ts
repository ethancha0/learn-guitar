import { NextResponse } from "next/server";
import { searchYouTube } from "@/lib/youtube/search";
import {
  httpStatusForYouTubeError,
  YouTubeToolError,
} from "@/lib/youtube/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof YouTubeToolError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details },
      { status: httpStatusForYouTubeError(err) },
    );
  }

  return NextResponse.json({ error: "YouTube search failed." }, { status: 500 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();

  try {
    return NextResponse.json({ results: await searchYouTube(q ?? "") });
  } catch (err) {
    return errorResponse(err);
  }
}
