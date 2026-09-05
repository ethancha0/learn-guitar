import { describe, expect, it, vi } from "vitest";
import {
  columnList,
  isMissingColumn,
  selectTolerantly,
} from "./supabaseSongStore";

/**
 * A project that has not run the latest `supabase/schema.sql` is missing the
 * columns added after the first release. Reads have to survive that rather than
 * failing the whole library, so they drop the offending column and retry.
 */
describe("columnList", () => {
  it("asks for every optional column by default", () => {
    const cols = columnList([]);
    expect(cols).toContain("youtube_source");
    expect(cols).toContain("sync_map");
  });

  it("omits only what it is told to", () => {
    const cols = columnList(["sync_map"]);
    expect(cols).toContain("youtube_source");
    expect(cols).not.toContain("sync_map");
  });

  it("still selects the base columns when every optional one is gone", () => {
    const cols = columnList(["youtube_source", "sync_map"]);
    expect(cols).toContain("id");
    expect(cols).toContain("tab_path");
    expect(cols).not.toContain("youtube_source");
    expect(cols).not.toContain("sync_map");
  });
});

describe("isMissingColumn", () => {
  it("recognises a read-side undefined column", () => {
    const err = { code: "42703", message: 'column songs.sync_map does not exist' };
    expect(isMissingColumn(err, "sync_map")).toBe(true);
  });

  it("does not blame a column the error never mentions", () => {
    const err = { code: "42703", message: 'column songs.sync_map does not exist' };
    expect(isMissingColumn(err, "youtube_source")).toBe(false);
  });

  it("treats a write-side schema-cache miss as missing", () => {
    expect(isMissingColumn({ code: "PGRST204" }, "sync_map")).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isMissingColumn({ code: "PGRST116", message: "no rows" }, "sync_map")).toBe(
      false,
    );
    expect(isMissingColumn(null, "sync_map")).toBe(false);
    expect(isMissingColumn("nope", "sync_map")).toBe(false);
  });
});

describe("selectTolerantly", () => {
  it("returns the first successful result untouched", async () => {
    const run = vi.fn(async () => ({ data: ["row"], error: null }));
    const result = await selectTolerantly(run);
    expect(result.data).toEqual(["row"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("drops a missing column and retries", async () => {
    const run = vi.fn(async (columns: string) =>
      columns.includes("sync_map")
        ? {
            data: null,
            error: { code: "42703", message: "column songs.sync_map does not exist" },
          }
        : { data: ["row"], error: null },
    );

    const result = await selectTolerantly(run);

    expect(result.error).toBeNull();
    expect(result.data).toEqual(["row"]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).not.toContain("sync_map");
  });

  it("drops each missing column in turn rather than giving up", async () => {
    const run = vi.fn(async (columns: string) => {
      for (const col of ["sync_map", "youtube_source"]) {
        if (columns.includes(col)) {
          return {
            data: null,
            error: { code: "42703", message: `column songs.${col} does not exist` },
          };
        }
      }
      return { data: ["row"], error: null };
    });

    const result = await selectTolerantly(run);

    expect(result.data).toEqual(["row"]);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("surfaces an error that is not about a droppable column", async () => {
    const run = vi.fn(async () => ({
      data: null,
      error: { code: "PGRST116", message: "no rows returned" },
    }));

    const result = await selectTolerantly(run);

    expect(result.error?.code).toBe("PGRST116");
    // No point retrying a query whose shape was never the problem.
    expect(run).toHaveBeenCalledTimes(1);
  });
});
