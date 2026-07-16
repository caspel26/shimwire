import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
});
