import { NextResponse } from "next/server";
import { searchSongsterr } from "@/lib/songsterr/api";
import { songsterrErrorResponse } from "@/lib/songsterr/errorResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  try {
    return NextResponse.json({ results: await searchSongsterr(q) });
  } catch (err) {
    return songsterrErrorResponse(err, "Songsterr search failed.");
  }
}
