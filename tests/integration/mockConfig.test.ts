import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");
const SPEC_PATH = join(import.meta.dir, "..", "fixtures", "petstore.openapi.yaml");

function waitForServer(url: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        await fetch(url);
        resolve();
      } catch {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("server did not start in time"));
        } else {
          setTimeout(tick, 100);
        }
      }
    };
    tick();
  });
}

describe("shimwire mock (config file)", () => {
  test("uses [mock] config defaults when no CLI args/flags are passed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-mock-config-"));
    mkdirSync(join(cwd, ".shimwire"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[mock]
spec = "${SPEC_PATH}"
port = 4999
`
    );

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "mock"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      await waitForServer("http://localhost:4999/pets");
      const res = await fetch("http://localhost:4999/pets");
      expect(res.status).toBe(200);
    } finally {
      proc.kill();
    }
  });

  test("--no-cors overrides a config default of cors = true", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-mock-config-"));
    mkdirSync(join(cwd, ".shimwire"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[mock]
spec = "${SPEC_PATH}"
port = 4998
cors = true
`
    );

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "mock", "--no-cors"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      await waitForServer("http://localhost:4998/pets");
      const res = await fetch("http://localhost:4998/pets", {
        headers: { origin: "http://localhost:3000" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      proc.kill();
    }
  });

  test("errors clearly when spec is missing from both CLI and config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-mock-config-"));

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "mock"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Missing "spec"');
  });
});
