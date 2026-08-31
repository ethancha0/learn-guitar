import { NextResponse } from "next/server";
import { SongsterrError } from "./types";

const STATUS_BY_CODE = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UPSTREAM_FAILED: 502,
} as const;

export function songsterrErrorResponse(err: unknown, fallback: string) {
  if (err instanceof SongsterrError) {
    return NextResponse.json(
      { error: err.message, details: err.details },
      { status: STATUS_BY_CODE[err.code] },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
