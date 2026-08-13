import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, close: () => client.close() };
}

function parseJsonContent(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text;
  if (typeof text !== "string") throw new Error("no text content in tool result");
  return JSON.parse(text);
}

describe("shimwire MCP server (in-process)", () => {
  test("lists every registered tool", async () => {
    const { client, close } = await connectedClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "create_workflow",
          "generate_collection",
          "get_mock_requests",
          "init_project",
          "list_collections",
          "list_mocks",
          "list_workflows",
          "load_spec",
          "run_collection",
          "start_mock",
          "stop_mock",
        ].sort()
      );
    } finally {
      await close();
    }
  });

  test("load_spec returns every operation in the petstore fixture", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "load_spec",
        arguments: { spec: join(FIXTURES, "petstore.openapi.yaml") },
      });
      const data = parseJsonContent(result) as {
        title: string;
        operationCount: number;
        operations: { id: string; method: string; path: string }[];
      };

      expect(data.title).toBe("Petstore");
      expect(data.operationCount).toBe(3);
      expect(data.operations.map((o) => o.id).sort()).toEqual(
        ["create_pet", "get_pet", "list_pets"].sort()
      );
    } finally {
      await close();
    }
  });

  test("load_spec reports a clean tool error for a missing file", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "load_spec",
        arguments: { spec: "/no/such/spec.yaml" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  test("init_project scaffolds .shimwire/ in the given cwd", async () => {
    const { client, close } = await connectedClient();
    try {
      const cwd = mkdtempSync(join(tmpdir(), "shimwire-mcp-init-"));
      const result = await client.callTool({ name: "init_project", arguments: { cwd } });
      const data = parseJsonContent(result) as { dirs: string[] };

      expect(existsSync(join(cwd, ".shimwire", "collections"))).toBe(true);
      expect(existsSync(join(cwd, ".shimwire", "workflows"))).toBe(true);
      expect(data.dirs).toContain("workflows");
    } finally {
      await close();
    }
  });

  test("concurrent tool calls with different cwds don't race on process.chdir", async () => {
    // Fired without awaiting between them — the MCP client can pipeline
    // calls over stdio without waiting for a prior response, so this is a
    // real scenario, not a contrived one (confirmed by hand against the
    // real `shimwire mcp` subprocess before the serializing queue was added:
    // an unserialized generate_collection + run_collection pair racing this
    // way produced a spurious "not found" for the second call).
    const { client, close } = await connectedClient();
    try {
      const cwdA = mkdtempSync(join(tmpdir(), "shimwire-mcp-race-a-"));
      const cwdB = mkdtempSync(join(tmpdir(), "shimwire-mcp-race-b-"));

      const [resultA, resultB] = await Promise.all([
        client.callTool({ name: "init_project", arguments: { cwd: cwdA } }),
        client.callTool({ name: "init_project", arguments: { cwd: cwdB } }),
      ]);

      const dataA = parseJsonContent(resultA) as { root: string };
      const dataB = parseJsonContent(resultB) as { root: string };

      // Each call's own reported root must match its own cwd, not the
      // other's — this is exactly what a chdir race would get wrong.
      // realpath because process.cwd() resolves symlinks (macOS's
      // /var -> /private/var) that mkdtempSync's return value doesn't.
      expect(dataA.root).toBe(join(realpathSync(cwdA), ".shimwire"));
      expect(dataB.root).toBe(join(realpathSync(cwdB), ".shimwire"));
      expect(existsSync(join(cwdA, ".shimwire", "collections"))).toBe(true);
      expect(existsSync(join(cwdB, ".shimwire", "collections"))).toBe(true);
    } finally {
      await close();
    }
  });

  test("generate_collection writes a collection and reports request/review counts", async () => {
    const { client, close } = await connectedClient();
    try {
      const cwd = mkdtempSync(join(tmpdir(), "shimwire-mcp-generate-"));
      mkdirSync(join(cwd, ".shimwire"), { recursive: true });

      const result = await client.callTool({
        name: "generate_collection",
        arguments: {
          spec: join(FIXTURES, "petstore.openapi.yaml"),
          out: ".shimwire/collections/petstore.toml",
          cwd,
        },
      });
      const data = parseJsonContent(result) as { requestCount: number; reviewNotes: string[] };

      expect(data.requestCount).toBe(3);
      expect(existsSync(join(cwd, ".shimwire", "collections", "petstore.toml"))).toBe(true);
    } finally {
      await close();
    }
  });

  test("create_workflow writes only the selected endpoints, skipping unknown ids", async () => {
    const { client, close } = await connectedClient();
    try {
      const cwd = mkdtempSync(join(tmpdir(), "shimwire-mcp-workflow-"));

      const result = await client.callTool({
        name: "create_workflow",
        arguments: {
          spec: join(FIXTURES, "auth-demo.openapi.yaml"),
          name: "authentication_flow",
          endpoints: ["login", "made_up_id"],
          cwd,
        },
      });
      const data = parseJsonContent(result) as { requestCount: number; skippedIds: string[] };

      expect(data.requestCount).toBe(1);
      expect(data.skippedIds).toEqual(["made_up_id"]);
      expect(existsSync(join(cwd, ".shimwire", "workflows", "authentication_flow.toml"))).toBe(
        true
      );
    } finally {
      await close();
    }
  });

  test("list_collections and list_workflows reflect what's on disk", async () => {
    const { client, close } = await connectedClient();
    try {
      const cwd = mkdtempSync(join(tmpdir(), "shimwire-mcp-list-"));
      mkdirSync(join(cwd, ".shimwire", "collections"), { recursive: true });
      mkdirSync(join(cwd, ".shimwire", "workflows"), { recursive: true });
      writeFileSync(join(cwd, ".shimwire", "collections", "a.toml"), "");
      writeFileSync(join(cwd, ".shimwire", "workflows", "b.toml"), "");

      const collections = parseJsonContent(
        await client.callTool({ name: "list_collections", arguments: { cwd } })
      ) as { files: string[] };
      const workflows = parseJsonContent(
        await client.callTool({ name: "list_workflows", arguments: { cwd } })
      ) as { files: string[] };

      expect(collections.files).toEqual(["a.toml"]);
      expect(workflows.files).toEqual(["b.toml"]);
    } finally {
      await close();
    }
  });

  test("run_collection executes a real collection and returns structured pass/fail", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/users/42") {
          return Response.json({ id: 42, name: "test" }, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const { client, close } = await connectedClient();
      try {
        const cwd = mkdtempSync(join(tmpdir(), "shimwire-mcp-run-"));
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
id = "get_user"
method = "GET"
path = "/users/42"
`
        );

        const result = await client.callTool({
          name: "run_collection",
          arguments: { collection: "users.toml", env: "dev", cwd },
        });
        const data = parseJsonContent(result) as {
          passed: number;
          failed: number;
          anyFailed: boolean;
          steps: { id: string; ok: boolean }[];
        };

        expect(data.passed).toBe(1);
        expect(data.failed).toBe(0);
        expect(data.anyFailed).toBe(false);
        expect(data.steps[0]?.id).toBe("get_user");
      } finally {
        await close();
      }
    } finally {
      server.stop(true);
    }
  });

  test("start_mock/get_mock_requests/stop_mock: full lifecycle of an MCP-started mock", async () => {
    const { client, close } = await connectedClient();
    try {
      const started = parseJsonContent(
        await client.callTool({
          name: "start_mock",
          arguments: { spec: join(FIXTURES, "petstore.openapi.yaml"), port: 4930 },
        })
      ) as { id: string; port: number; url: string; endpointCount: number };

      expect(started.port).toBe(4930);
      expect(started.url).toBe("http://localhost:4930");
      expect(started.endpointCount).toBe(3);

      const listed = parseJsonContent(
        await client.callTool({ name: "list_mocks", arguments: {} })
      ) as { mocks: { id: string; port: number }[] };
      expect(listed.mocks.map((m) => m.id)).toContain(started.id);

      const res = await fetch("http://localhost:4930/pets");
      expect(res.status).toBe(200);

      const requests = parseJsonContent(
        await client.callTool({ name: "get_mock_requests", arguments: { id: started.id } })
      ) as { requests: { method: string; path: string; status: number }[] };
      expect(requests.requests).toEqual([
        expect.objectContaining({ method: "GET", path: "/pets", status: 200 }),
      ]);

      const stopped = parseJsonContent(
        await client.callTool({ name: "stop_mock", arguments: { id: started.id } })
      ) as { stopped: boolean };
      expect(stopped.stopped).toBe(true);

      await expect(fetch("http://localhost:4930/pets")).rejects.toThrow();

      const afterStop = parseJsonContent(
        await client.callTool({ name: "list_mocks", arguments: {} })
      ) as { mocks: { id: string }[] };
      expect(afterStop.mocks.map((m) => m.id)).not.toContain(started.id);
    } finally {
      await close();
    }
  });

  test("stop_mock reports a clean tool error for an unknown id", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "stop_mock",
        arguments: { id: "no-such-id" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  test("run_collection reports a clean tool error when nothing resolves", async () => {
    const { client, close } = await connectedClient();
    try {
      const cwd = mkdtempSync(join(tmpdir(), "shimwire-mcp-run-missing-"));
      const result = await client.callTool({
        name: "run_collection",
        arguments: { collection: "nope.toml", env: "dev", cwd },
      });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("shimwire mcp (real subprocess, stdio)", () => {
  test("handshake + tool call round-trip, and stdout stays clean JSON-RPC only", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "mcp"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const writer = proc.stdin;
    const send = (msg: object) => writer.write(JSON.stringify(msg) + "\n");

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "load_spec", arguments: { spec: join(FIXTURES, "petstore.openapi.yaml") } },
    });

    // Give it a moment to respond, then close stdin and collect output.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    writer.end();
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Every single line must be valid JSON-RPC — this is the property that
    // actually matters: if any log line had leaked to stdout, this parse
    // would fail on it.
    const messages = lines.map((line) => JSON.parse(line));
    expect(messages.every((m) => m.jsonrpc === "2.0")).toBe(true);

    const toolCallResponse = messages.find((m) => m.id === 2);
    expect(toolCallResponse).toBeDefined();
    const text = toolCallResponse.result.content[0].text;
    const data = JSON.parse(text);
    expect(data.title).toBe("Petstore");
  });
});
