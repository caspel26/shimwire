import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("scaffolds .shimwire/ with collections, env, mock, and workflows dirs", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, ".shimwire", "collections"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "env", "dev.toml"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "mock"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "workflows"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "config.toml"))).toBe(true);
  });

  test("fails if .shimwire/ already exists", async () => {
    await Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd }).exited;
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
  });

  test("creates a .gitignore protecting .shimwire/env when none exists", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    await proc.exited;

    const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
    expect(gitignore).toContain(".shimwire/env/*.toml");
  });

  test("appends to an existing .gitignore instead of overwriting it", async () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    await proc.exited;

    const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".shimwire/env/*.toml");
  });

  test("doesn't duplicate the entry if .gitignore already covers .shimwire/env", async () => {
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.shimwire/env/*.toml\n");

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "init"], { cwd });
    await proc.exited;

    const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
    expect(gitignore.match(/\.shimwire\/env/g)?.length).toBe(1);
  });
});
