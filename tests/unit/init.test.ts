import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

describe("shimwire init", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "shimwire-test-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("scaffolds .shimwire/ with collections, env, and mock dirs", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, ".shimwire", "collections"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "env", "dev.toml"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "mock"))).toBe(true);
  });

  test("fails if .shimwire/ already exists", async () => {
    await Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd }).exited;
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
  });
});
