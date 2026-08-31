import {
  accountSongFileResponse,
  songFileErrorResponse,
} from "@/lib/supabase/songFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ songId: string }> },
) {
  try {
    const { songId } = await params;
    return await accountSongFileResponse(songId, "tab");
  } catch (error) {
    return songFileErrorResponse(error);
  }
}
