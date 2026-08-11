#!/usr/bin/env bun
// A minimal MCP client — stands in for an AI agent (Claude Desktop, Claude
// Code, or anything else that speaks MCP) driving the real `shimwire mcp`
// server over real stdio JSON-RPC. Every call here is genuine; nothing in
// this script's output is fabricated. Used to record assets/mcp-demo.gif —
// see assets/mcp-demo.tape.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pc from "picocolors";

interface ToolTextResult {
  content: { type: string; text: string }[];
}

interface LoadSpecResult {
  title: string;
  operationCount: number;
  operations: { id: string; method: string; path: string }[];
}

interface GenerateResult {
  requestCount: number;
  out: string;
  workflowPath?: string;
}

interface RunResult {
  passed: number;
  failed: number;
  steps: { id: string; method: string; path: string; ok: boolean; status?: number }[];
}

const CLI_PATH = process.env.SHIMWIRE_CLI_PATH ?? "src/cli.ts";

// Local tool calls against a mock server resolve in single-digit
// milliseconds, so without this the whole session would print and scroll
// past in under a second — unreadable as a recording. This script's only
// purpose is producing assets/mcp-demo.gif, so baking in demo pacing here
// is fine; it doesn't ship in the npm package (assets/ is excluded).
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function banner(title: string, lines: string[]): void {
  console.log(pc.bold(pc.magenta(title)));
  console.log(pc.magenta("─".repeat(title.length)));
  for (const line of lines) console.log(pc.dim(line));
}

banner("AI agent session, over real MCP (stdio JSON-RPC)", [
  "This script IS the AI client. It spawns `shimwire mcp` as a subprocess",
  "and talks to it over stdin/stdout — the exact same thing Claude",
  "Desktop/Code do with the mcpServers config shown above. Every call",
  "below is a real tool call to that live process, not simulated output.",
]);

await pause(800);
const client = new Client({ name: "agent-demo", version: "0.0.1" });
const transport = new StdioClientTransport({ command: "bun", args: ["run", CLI_PATH, "mcp"] });
await client.connect(transport);
console.log(pc.dim(`\nconnected — shimwire mcp is running as pid ${transport.pid}`));
await pause(700);

function step(n: number, tool: string, why: string, label: string): void {
  console.log(pc.bold(pc.cyan(`\n${n}. agent calls "${tool}"`)) + pc.dim(` — ${why}`));
  console.log(pc.dim(`   ${label}`));
}

async function call<T>(name: string, args: object): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as ToolTextResult;
  return JSON.parse(result.content[0]?.text ?? "null") as T;
}

step(
  1,
  "load_spec",
  "see what's actually in the spec before doing anything",
  'load_spec({ spec: "openapi.yaml" })'
);
await pause(500);
const spec = await call<LoadSpecResult>("load_spec", { spec: "openapi.yaml" });
console.log(pc.green(`   ✓ "${spec.title}" — ${spec.operationCount} operation(s)`));
for (const op of spec.operations) {
  console.log(pc.dim(`       ${op.method.padEnd(6)} ${op.path}  (${op.id})`));
}
await pause(1100);

step(
  2,
  "generate_collection",
  "scaffold a runnable collection from the spec",
  'generate_collection({ spec: "openapi.yaml", out: ".shimwire/collections/api.toml" })'
);
await pause(500);
const gen = await call<GenerateResult>("generate_collection", {
  spec: "openapi.yaml",
  out: ".shimwire/collections/api.toml",
});
console.log(pc.green(`   ✓ wrote ${gen.requestCount} request(s) to ${gen.out}`));
if (gen.workflowPath) {
  console.log(
    pc.green(`   ✓ login auto-extracted into ${gen.workflowPath.split("/").slice(-2).join("/")}`)
  );
}
await pause(1100);

step(
  3,
  "run_collection",
  "execute it and check the real result",
  'run_collection({ collection: "api.toml", env: "dev" })'
);
await pause(500);
const run = await call<RunResult>("run_collection", { collection: "api.toml", env: "dev" });
for (const s of run.steps) {
  const mark = s.ok ? pc.green("✓") : pc.red("✗");
  console.log(`   ${mark} ${s.id.padEnd(14)} ${s.method.padEnd(6)} ${s.path}  ${s.status}`);
}
console.log(pc.bold(`\n   ${run.passed} passed, ${run.failed} failed`));
await pause(1300);

await client.close();

// Not a tool call — just reading the actual files back off disk, to prove
// the calls above wrote real project files and didn't just return JSON.
banner("\nWhat actually landed on disk", [
  "No shimwire CLI command ran directly — the agent's tool calls above are",
  "the only thing that touched the filesystem.",
]);
await pause(600);
// gen.out is relative to cwd; gen.workflowPath (when present) is already
// absolute — normalize both to an absolute path to read, and a clean
// relative path to display.
const written = [gen.out, gen.workflowPath].filter((p): p is string => Boolean(p));
for (const path of written) {
  const absolute = path.startsWith("/") ? path : join(process.cwd(), path);
  console.log(pc.cyan(`\n$ cat ${relative(process.cwd(), absolute)}`));
  console.log(pc.dim(readFileSync(absolute, "utf8").trimEnd()));
  await pause(900);
}
