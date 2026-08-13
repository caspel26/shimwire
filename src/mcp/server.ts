import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import { loadEnvironment, loadRunnable } from "../core/collection/parser.ts";
import { executeCollection } from "../core/executor/collectionRunner.ts";
import { listOperationsWithIds } from "../core/openapi/generate.ts";
import { listOperations, loadOpenApiSpec } from "../core/openapi/loader.ts";
import { performGenerate } from "../commands/generate.ts";
import { performInit } from "../commands/init.ts";
import { startMockServer } from "../commands/mock.ts";
import { resolveCollectionPath, resolveEnvPath } from "../commands/run.ts";
import { performWorkflow } from "../commands/workflow.ts";
import {
  createMockInstance,
  getMockInstance,
  listMockInstances,
  type MockInstance,
  recordMockRequest,
  stopMockInstance,
} from "./mockRegistry.ts";

// Every tool here calls only the *performX* / core functions, never the CLI
// wrapper functions that call log.* — those write to console.log, i.e.
// stdout, which on this transport IS the JSON-RPC protocol channel. A stray
// log line would corrupt every message after it. (registerMcpCommand also
// redirects console.log globally as a second line of defense, but the tools
// themselves are written to not need it.)

// MCP tool calls are one-shot request/response — there's no notion of "the
// project I'm working on" the way a CLI invocation's cwd gives you for free,
// so each tool takes an optional `cwd` and chdirs for the call's duration.
// process.chdir is process-global state, and JSON-RPC over stdio allows a
// client to pipeline several calls without waiting for a response first
// (that's what request `id` correlation is for) — confirmed empirically,
// not just in theory, that two calls really can be in flight at once here.
// This queue gives mutual exclusion so overlapping calls can never corrupt
// each other's chdir state, regardless of which order they happen to run
// in. It does NOT guarantee calls execute in client-send order — the
// protocol itself doesn't promise that either. A client that needs call B
// to see call A's completed side effects (e.g. generate_collection's
// written file before run_collection reads it) has to await A's response
// before issuing B, exactly as it would with any other RPC API.
let queue: Promise<unknown> = Promise.resolve();

async function withCwd<T>(cwd: string | undefined, fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (!cwd) return fn();
    const original = process.cwd();
    process.chdir(cwd);
    try {
      return await fn();
    } finally {
      process.chdir(original);
    }
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function listTomlFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries.filter((file) => file.endsWith(".toml"));
}

const specArgs = {
  spec: z.string().describe("Path or URL to an OpenAPI 3.x / Swagger 2.0 spec"),
  cwd: z
    .string()
    .optional()
    .describe("Project directory to operate in (defaults to the server's own cwd)"),
  allowLocal: z
    .boolean()
    .optional()
    .describe("Allow fetching the spec from localhost/private-network URLs"),
  insecure: z
    .boolean()
    .optional()
    .describe("Skip TLS certificate verification while fetching the spec"),
};

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "shimwire", version: pkg.version });

  server.registerTool(
    "load_spec",
    {
      title: "Load an OpenAPI spec",
      description:
        "Parse an OpenAPI/Swagger spec and list every operation (id, method, path) it defines — use this before generate_collection/create_workflow to see what ids are actually available to reference.",
      inputSchema: specArgs,
    },
    async ({ spec, cwd, allowLocal, insecure }) => {
      try {
        return await withCwd(cwd, async () => {
          const doc = await loadOpenApiSpec(spec, { allowLocal, insecure });
          const operations = listOperationsWithIds(doc).map(({ op, id }) => ({
            id,
            method: op.method.toUpperCase(),
            path: op.path,
          }));
          return jsonResult({
            title: doc.info?.title ?? "untitled spec",
            operationCount: operations.length,
            operations,
          });
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "init_project",
    {
      title: "Scaffold a shimwire project",
      description:
        "Create .shimwire/{collections,env,mock,workflows}/, a starter config.toml, and a .gitignore entry for secrets. Fails if .shimwire/ already exists.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Directory to scaffold in (defaults to the server's own cwd)"),
      },
    },
    async ({ cwd }) => {
      try {
        return await withCwd(cwd, async () => {
          const result = await performInit();
          return jsonResult(result);
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "generate_collection",
    {
      title: "Generate a collection from a spec",
      description:
        "Auto-scaffold a runnable .toml collection covering every operation in a spec, with heuristic depends_on linking and auth pre-fill. If the spec has a login-shaped operation, it's extracted into a reusable authentication_flow workflow automatically. Returns review notes for anything that needs a human look (unresolved path params, faked credentials, etc.) — read them back before treating the result as done.",
      inputSchema: {
        ...specArgs,
        out: z
          .string()
          .describe("Output path for the collection .toml, e.g. .shimwire/collections/api.toml"),
        security: z
          .string()
          .optional()
          .describe(
            "When a spec offers multiple auth alternatives, prefer this securitySchemes name"
          ),
      },
    },
    async ({ spec, out, cwd, security, allowLocal, insecure }) => {
      try {
        return await withCwd(cwd, async () => {
          const result = await performGenerate(spec, out, { security, allowLocal, insecure });
          return jsonResult(result);
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "create_workflow",
    {
      title: "Save endpoints as a reusable workflow",
      description:
        'Pick specific endpoints (by the ids load_spec reported) from a spec and save them as .shimwire/workflows/<name>.toml — a request list any collection can pull in via include = ["<name>"], or run directly with run_collection. Unknown ids are skipped with a note, not a hard failure.',
      inputSchema: {
        ...specArgs,
        name: z.string().describe("Workflow name — written to .shimwire/workflows/<name>.toml"),
        endpoints: z
          .array(z.string())
          .min(1)
          .describe("Request ids to include, from load_spec's output"),
        security: z
          .string()
          .optional()
          .describe(
            "When a spec offers multiple auth alternatives, prefer this securitySchemes name"
          ),
      },
    },
    async ({ spec, name, endpoints, cwd, security, allowLocal, insecure }) => {
      try {
        return await withCwd(cwd, async () => {
          const result = await performWorkflow(spec, name, endpoints, {
            security,
            allowLocal,
            insecure,
          });
          return jsonResult(result);
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description: "List every collection .toml under .shimwire/collections/.",
      inputSchema: { cwd: z.string().optional() },
    },
    async ({ cwd }) => {
      try {
        return await withCwd(cwd, async () => {
          const files = await listTomlFiles(join(process.cwd(), ".shimwire", "collections"));
          return jsonResult({ files });
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description: "List every workflow .toml under .shimwire/workflows/.",
      inputSchema: { cwd: z.string().optional() },
    },
    async ({ cwd }) => {
      try {
        return await withCwd(cwd, async () => {
          const files = await listTomlFiles(join(process.cwd(), ".shimwire", "workflows"));
          return jsonResult({ files });
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "run_collection",
    {
      title: "Run a collection or workflow",
      description:
        "Execute a collection (or a standalone workflow — same resolution rules as `shimwire run`) against a real backend and return structured pass/fail per step, so you can verify the result instead of assuming it worked. Accepts a path, or a bare filename resolved under .shimwire/collections/ then .shimwire/workflows/.",
      inputSchema: {
        collection: z.string().describe("Path or filename of the collection/workflow to run"),
        env: z
          .string()
          .default("dev")
          .describe("Environment name, looked up under .shimwire/env/<name>.toml"),
        cwd: z.string().optional(),
        only: z.string().optional().describe("Run only this request id plus its dependencies"),
        insecure: z.boolean().optional().describe("Skip TLS certificate verification"),
      },
    },
    async ({ collection, env, cwd, only, insecure }) => {
      try {
        return await withCwd(cwd, async () => {
          const collectionPath = resolveCollectionPath(collection);
          const envPath = resolveEnvPath(env);
          const loaded = await loadRunnable(collectionPath);
          const loadedEnv = await loadEnvironment(envPath);

          const { reportEntries, anyFailed } = await executeCollection(loaded, loadedEnv, {
            only,
            insecure,
          });

          const passed = reportEntries.filter((entry) => entry.ok).length;
          return jsonResult({
            passed,
            failed: reportEntries.length - passed,
            anyFailed,
            steps: reportEntries,
          });
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "start_mock",
    {
      title: "Start a mock server",
      description:
        "Start a fake-but-schema-valid mock server from a spec and leave it running in the background — same engine as `shimwire mock`. Returns an id; pass it to stop_mock/get_mock_requests. Runs until stop_mock is called or this MCP server process exits (every mock it started is closed on shutdown).",
      inputSchema: {
        ...specArgs,
        port: z.number().int().optional().describe("Port to listen on (default: 4000)"),
        overrides: z
          .string()
          .optional()
          .describe(
            "Path to an overrides.toml (defaults to .shimwire/mock/overrides.toml if present)"
          ),
        cors: z.boolean().optional().describe("Send permissive CORS headers (default: true)"),
      },
    },
    async ({ spec, cwd, port, overrides, allowLocal, insecure, cors }) => {
      try {
        return await withCwd(cwd, async () => {
          // buildMockServer wires onRequestLogged in at construction time —
          // before that returns, there's nothing to log into yet. `ref` is
          // filled in synchronously right after startMockServer resolves (no
          // `await` in between), so no request can slip through the gap.
          const ref: { instance?: MockInstance } = {};
          const result = await startMockServer(spec, {
            port,
            overrides,
            allowLocal,
            insecure,
            cors,
            onRequestLogged: (entry) => {
              if (ref.instance) recordMockRequest(ref.instance, entry);
            },
          });
          const instance = createMockInstance({ port: result.port, spec, app: result.app });
          ref.instance = instance;
          return jsonResult({
            id: instance.id,
            port: instance.port,
            url: `http://localhost:${instance.port}`,
            endpointCount: listOperations(result.spec).length,
          });
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "stop_mock",
    {
      title: "Stop a mock server",
      description: "Stop a mock server previously started with start_mock.",
      inputSchema: { id: z.string().describe("id returned by start_mock") },
    },
    async ({ id }) => {
      try {
        const stopped = await stopMockInstance(id);
        if (!stopped) return errorResult(new Error(`No running mock with id "${id}"`));
        return jsonResult({ stopped: true, id });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "list_mocks",
    {
      title: "List running mock servers",
      description: "List every mock server started with start_mock that hasn't been stopped.",
      inputSchema: {},
    },
    async () => {
      try {
        const mocks = listMockInstances().map(({ id, port, spec, startedAt, requestLog }) => ({
          id,
          port,
          spec,
          startedAt,
          requestCount: requestLog.length,
        }));
        return jsonResult({ mocks });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_mock_requests",
    {
      title: "Read a mock server's recent traffic",
      description:
        "Return the most recent requests a start_mock-started server has handled (method, path, status, duration) — the pull-based equivalent of `shimwire mock`'s live --watch log, which can't be streamed over this transport.",
      inputSchema: {
        id: z.string().describe("id returned by start_mock"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Most recent N requests to return (default: all buffered, up to 200)"),
      },
    },
    async ({ id, limit }) => {
      try {
        const instance = getMockInstance(id);
        if (!instance) return errorResult(new Error(`No running mock with id "${id}"`));
        const log = limit ? instance.requestLog.slice(-limit) : instance.requestLog;
        return jsonResult({ requests: log });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}
