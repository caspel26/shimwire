import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOverrides, resolveOverrideResponse } from "../../src/mockServer/overrides.ts";

async function loadTomlOverrides(toml: string) {
  const dir = await mkdtemp(join(tmpdir(), "shimwire-overrides-"));
  const path = join(dir, "overrides.toml");
  await writeFile(path, toml, "utf8");
  return loadOverrides(path);
}

describe("loadOverrides validation", () => {
  test("rejects an entry with neither path nor path_regex", async () => {
    await expect(
      loadTomlOverrides(`
[[override]]
method = "GET"
status = 404
`)
    ).rejects.toThrow();
  });

  test("rejects an entry with both path and path_regex", async () => {
    await expect(
      loadTomlOverrides(`
[[override]]
path = "/pets"
path_regex = "/pets"
method = "GET"
status = 404
`)
    ).rejects.toThrow();
  });

  test("rejects sequence combined with a top-level status", async () => {
    await expect(
      loadTomlOverrides(`
[[override]]
path = "/pets"
method = "GET"
status = 500
[[override.sequence]]
status = 200
`)
    ).rejects.toThrow();
  });

  test("accepts a well-formed sequence override with default sequence_mode", async () => {
    const overrides = await loadTomlOverrides(`
[[override]]
path = "/pets"
method = "GET"
[[override.sequence]]
status = 200
[[override.sequence]]
status = 500
`);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.sequence_mode).toBe("repeat_last");
  });
});

describe("resolveOverrideResponse", () => {
  test("returns the top-level status/latency/body when there's no sequence", () => {
    const entry = { method: "GET", path: "/pets", status: 200, body: { ok: true } };
    expect(resolveOverrideResponse(entry)).toEqual({
      status: 200,
      latency_ms: undefined,
      body: { ok: true },
    });
  });

  test("repeats the last sequence step once exhausted (default mode)", () => {
    const entry = {
      method: "GET",
      path: "/pets",
      sequence: [{ status: 200 }, { status: 500 }],
    };
    expect(resolveOverrideResponse(entry).status).toBe(200);
    expect(resolveOverrideResponse(entry).status).toBe(500);
    expect(resolveOverrideResponse(entry).status).toBe(500);
    expect(resolveOverrideResponse(entry).status).toBe(500);
  });

  test("cycles back to the first sequence step when sequence_mode is cycle", () => {
    const entry = {
      method: "GET",
      path: "/pets",
      sequence: [{ status: 200 }, { status: 500 }],
      sequence_mode: "cycle" as const,
    };
    expect(resolveOverrideResponse(entry).status).toBe(200);
    expect(resolveOverrideResponse(entry).status).toBe(500);
    expect(resolveOverrideResponse(entry).status).toBe(200);
    expect(resolveOverrideResponse(entry).status).toBe(500);
  });
});
