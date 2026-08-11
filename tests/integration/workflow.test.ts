import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");
const SPEC_PATH = join(import.meta.dir, "..", "fixtures", "auth-demo.openapi.yaml");

describe("shimwire workflow", () => {
  test("writes the selected endpoints to .shimwire/workflows/<name>.toml", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "workflow",
        "--from",
        SPEC_PATH,
        "--name",
        "authentication_flow",
        "--endpoints",
        "login",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Wrote 1 request(s)");
    const workflowPath = join(cwd, ".shimwire", "workflows", "authentication_flow.toml");
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf8");
    expect(content).toContain('id = "login"');
    expect(content).not.toContain("get_user");
  });

  test("accepts multiple comma-separated endpoint ids", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "workflow",
        "--from",
        SPEC_PATH,
        "--name",
        "full_flow",
        "--endpoints",
        "login,get_user",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    const content = readFileSync(join(cwd, ".shimwire", "workflows", "full_flow.toml"), "utf8");
    expect(content).toContain('id = "login"');
    expect(content).toContain('id = "get_user"');
  });

  test("warns and skips unknown endpoint ids without failing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "workflow",
        "--from",
        SPEC_PATH,
        "--name",
        "partial",
        "--endpoints",
        "login,made_up_id",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Skipped unknown endpoint id(s): made_up_id");
    expect(existsSync(join(cwd, ".shimwire", "workflows", "partial.toml"))).toBe(true);
  });

  test("errors clearly when no endpoint in --endpoints matches the spec", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "workflow",
        "--from",
        SPEC_PATH,
        "--name",
        "nothing",
        "--endpoints",
        "not_a_real_id",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("None of the given endpoints matched");
  });

  test("errors clearly when --name is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "workflow", "--from", SPEC_PATH, "--endpoints", "login"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Missing "name"');
  });

  test("errors clearly when --endpoints is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "workflow", "--from", SPEC_PATH, "--name", "x"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Missing "endpoints"');
  });

  test("the written workflow file is valid enough for a collection to include and run", async () => {
    const { loadCollection } = await import("../../src/core/collection/parser.ts");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const cwd = mkdtempSync(join(tmpdir(), "shimwire-workflow-"));

    const genProc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "workflow",
        "--from",
        SPEC_PATH,
        "--name",
        "authentication_flow",
        "--endpoints",
        "login",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    expect(await genProc.exited).toBe(0);

    mkdirSync(join(cwd, ".shimwire", "collections"), { recursive: true });
    const collectionPath = join(cwd, ".shimwire", "collections", "users.toml");
    writeFileSync(
      collectionPath,
      `[meta]
name = "Users API"
base_url = "http://x"
include = ["authentication_flow"]

[[request]]
id = "get_user"
method = "GET"
path = "/users/42"
depends_on = ["login"]
`
    );

    const original = process.cwd();
    process.chdir(cwd);
    try {
      const collection = await loadCollection(collectionPath);
      expect(collection.request.map((r) => r.id)).toEqual(["login", "get_user"]);
    } finally {
      process.chdir(original);
    }
  });
});
