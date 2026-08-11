import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/users") {
        return Response.json({ id: 42, name: "test" }, { status: 201 });
      }
      if (req.method === "GET" && url.pathname === "/users/42") {
        return Response.json({ id: 42, name: "test" }, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function setupProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "shimwire-run-test-"));
  mkdirSync(join(cwd, ".shimwire", "env"), { recursive: true });
  writeFileSync(
    join(cwd, ".shimwire", "env", "dev.toml"),
    `base_url = "http://localhost:${server.port}"\n`
  );
  writeFileSync(
    join(cwd, "users.toml"),
    `[meta]
name = "Users API"
base_url = "{{env.base_url}}"

[[request]]
id = "create_user"
method = "POST"
path = "/users"
[request.body]
name = "test"

[[request]]
id = "get_user"
method = "GET"
path = "/users/{{steps.create_user.response.id}}"
depends_on = ["create_user"]
`
  );
  return cwd;
}

describe("shimwire run", () => {
  test("chains create_user -> get_user against a real server", async () => {
    const cwd = setupProject();

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "run", "users.toml", "--env", "dev", "--fail-on-error"],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("create_user");
    expect(stdout).toContain("POST");
    expect(stdout).toContain("201");
    expect(stdout).toContain("get_user");
    expect(stdout).toContain("/users/42");
    expect(stdout).toContain("200");
  });

  test("--only runs a single request plus its dependencies", async () => {
    const cwd = setupProject();

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "run",
        "users.toml",
        "--env",
        "dev",
        "--only",
        "get_user",
        "--fail-on-error",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("create_user");
    expect(stdout).toContain("get_user");
  });

  test("exits non-zero with --fail-on-error when a request fails", async () => {
    const cwd = setupProject();
    writeFileSync(
      join(cwd, "broken.toml"),
      `[meta]
name = "Broken"
base_url = "{{env.base_url}}"

[[request]]
id = "missing"
method = "GET"
path = "/does-not-exist"
`
    );

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "run", "broken.toml", "--env", "dev", "--fail-on-error"],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
  });

  test("--report writes an HTML report covering every step", async () => {
    const cwd = setupProject();
    const reportPath = join(cwd, "report.html");

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "run", "users.toml", "--env", "dev", "--report", reportPath],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(reportPath)).toBe(true);

    const html = readFileSync(reportPath, "utf8");
    expect(html).toContain("create_user");
    expect(html).toContain("get_user");
    expect(html).toContain("2 passed");
  });

  test("picks up [run].report from .shimwire/config.toml when --report isn't passed", async () => {
    const cwd = setupProject();
    writeFileSync(join(cwd, ".shimwire", "config.toml"), `[run]\nreport = "from-config.html"\n`);

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "run", "users.toml", "--env", "dev"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, "from-config.html"))).toBe(true);
  });

  test("--report overrides [run].report from config", async () => {
    const cwd = setupProject();
    writeFileSync(
      join(cwd, ".shimwire", "config.toml"),
      `[run]\nreport = "should-not-be-used.html"\n`
    );

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "run", "users.toml", "--env", "dev", "--report", "overridden.html"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, "overridden.html"))).toBe(true);
    expect(existsSync(join(cwd, "should-not-be-used.html"))).toBe(false);
  });
});

describe("shimwire run (standalone workflow)", () => {
  test("runs a .shimwire/workflows/<name>.toml directly, without wrapping it in a collection", async () => {
    const cwd = setupProject();
    mkdirSync(join(cwd, ".shimwire", "workflows"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "workflows", "create_user_flow.toml"),
      `[[request]]
id = "create_user"
method = "POST"
path = "/users"
[request.body]
name = "test"

[[request]]
id = "get_user"
method = "GET"
path = "/users/{{steps.create_user.response.id}}"
depends_on = ["create_user"]
`
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        CLI_PATH,
        "run",
        ".shimwire/workflows/create_user_flow.toml",
        "--env",
        "dev",
        "--fail-on-error",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("create_user");
    expect(stdout).toContain("get_user");
    expect(stdout).toContain("/users/42");
  });

  test("resolves a bare workflow filename via .shimwire/workflows/ the same way collections resolve", async () => {
    const cwd = setupProject();
    mkdirSync(join(cwd, ".shimwire", "workflows"), { recursive: true });
    writeFileSync(
      join(cwd, ".shimwire", "workflows", "quick_check.toml"),
      `[[request]]
id = "get_user"
method = "GET"
path = "/users/42"
`
    );

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "run", "quick_check.toml", "--env", "dev", "--fail-on-error"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("get_user");
  });

  test("errors clearly when neither a collection nor a workflow matches", async () => {
    const cwd = setupProject();

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "run", "nope.toml", "--env", "dev"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Collection or workflow not found");
  });
});
