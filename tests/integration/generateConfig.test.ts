import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");
const SPEC_PATH = join(import.meta.dir, "..", "fixtures", "petstore.openapi.yaml");

describe("shimwire generate (config file)", () => {
  test("uses .shimwire/config.toml defaults when no CLI flags are passed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-generate-config-"));
    mkdirSync(join(cwd, ".shimwire"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[generate]
from = "${SPEC_PATH}"
out = ".shimwire/collections/petstore.toml"
`
    );

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "generate"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Wrote 3 request(s)");
    expect(existsSync(join(cwd, ".shimwire", "collections", "petstore.toml"))).toBe(true);
  });

  test("a CLI flag overrides the config file value", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-generate-config-"));
    mkdirSync(join(cwd, ".shimwire"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[generate]
from = "${SPEC_PATH}"
out = ".shimwire/collections/should-not-be-used.toml"
`
    );

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "generate", "--out", ".shimwire/collections/overridden.toml"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, ".shimwire", "collections", "overridden.toml"))).toBe(true);
    expect(existsSync(join(cwd, ".shimwire", "collections", "should-not-be-used.toml"))).toBe(
      false
    );
  });

  test("errors clearly when from/out are missing from both CLI and config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-generate-config-"));

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "generate"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Missing "from"');
  });
});
