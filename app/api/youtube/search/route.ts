import { NextResponse } from "next/server";
import { searchYouTube } from "@/lib/youtube/search";
import { YouTubeToolError } from "@/lib/youtube/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof YouTubeToolError) {
    const status =
      err.code === "MISSING_DEPENDENCY"
        ? 503
        : err.code === "VALIDATION"
          ? 400
          : 502;
    return NextResponse.json(
      { error: err.message, details: err.details },
      { status },
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
