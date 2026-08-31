import { createClient } from "@/lib/supabase/server";

const BUCKET = "song-files";

interface SongFileRow {
  id: string;
  tab_path: string;
  audio_path: string;
  tab_file_name: string;
  audio_file_names: string[];
}

export class SongFileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SongFileError";
  }
}

function contentTypeForFileName(fileName: string, fallback: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".gp") || lower.endsWith(".gp7")) return "application/gp";
  if (lower.endsWith(".gpx")) return "application/gpx+xml";
  if (lower.endsWith(".ptb")) return "application/octet-stream";
  return fallback;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/["\r\n]/g, "") || "song-file";
}

async function getSongFileRow(songId: string): Promise<SongFileRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("songs")
    .select("id,tab_path,audio_path,tab_file_name,audio_file_names")
    .eq("id", songId)
    .single<SongFileRow>();

  if (error || !data) {
    throw new SongFileError("Song was not found in this account.", 404);
  }

  return data;
}

async function downloadStorageFile(path: string): Promise<Blob> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new SongFileError(
      error?.message ?? "Could not download this account file.",
      error?.message?.toLowerCase().includes("not found") ? 404 : 403,
    );
  }
  return data;
}

export async function accountSongFileResponse(
  songId: string,
  kind: "tab" | "audio",
): Promise<Response> {
  const row = await getSongFileRow(songId);
  const fileName =
    kind === "tab"
      ? row.tab_file_name
      : (row.audio_file_names?.[0] ?? "backing-audio");
  const storagePath = kind === "tab" ? row.tab_path : row.audio_path;
  const fallbackType = kind === "tab" ? "application/octet-stream" : "audio/mpeg";
  const blob = await downloadStorageFile(storagePath);

  return new Response(new Uint8Array(await blob.arrayBuffer()), {
    headers: {
      "Content-Type": blob.type || contentTypeForFileName(fileName, fallbackType),
      "Content-Disposition": `attachment; filename="${safeFileName(fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function songFileErrorResponse(error: unknown): Response {
  if (error instanceof SongFileError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: "Could not load this account song file." },
    { status: 500 },
  );
}
