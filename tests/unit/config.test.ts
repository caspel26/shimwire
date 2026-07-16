import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config/config.ts";

describe("loadConfig", () => {
  test("returns {} when .shimwire/config.toml doesn't exist", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-config-test-"));
    expect(await loadConfig(cwd)).toEqual({});
  });

  test("parses a [generate] section", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-config-test-"));
    mkdirSync(join(cwd, ".shimwire"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[generate]
from = "https://localhost:8080/openapi.json"
security = "ManagerUserApiKeyAuth"
allow_local = true
insecure = true
out = ".shimwire/collections/api.toml"
`
    );

    const config = await loadConfig(cwd);
    expect(config.generate).toEqual({
      from: "https://localhost:8080/openapi.json",
      security: "ManagerUserApiKeyAuth",
      allow_local: true,
      insecure: true,
      out: ".shimwire/collections/api.toml",
    });
  });

  test("parses a [run] section", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-config-test-"));
    mkdirSync(join(cwd, ".shimwire"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[run]
report = ".shimwire/reports/latest.html"
`
    );

    const config = await loadConfig(cwd);
    expect(config.run).toEqual({ report: ".shimwire/reports/latest.html" });
  });
});
