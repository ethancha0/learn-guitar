import { NextResponse } from "next/server";
import { pickBassTrack, resolveSongsterrSong } from "@/lib/songsterr/api";
import { songsterrErrorResponse } from "@/lib/songsterr/errorResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("url")?.trim() ?? "";

  try {
    const { song, ref } = await resolveSongsterrSong(input);
    return NextResponse.json({
      song,
      suggestedTrack: pickBassTrack(song, ref) ?? null,
    });
  } catch (err) {
    return songsterrErrorResponse(err, "Songsterr lookup failed.");
  }
}
