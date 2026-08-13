import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkbox, confirm, input, select, Separator } from "@inquirer/prompts";
import type { Theme } from "@inquirer/core";
import boxen from "boxen";
import type { Command } from "commander";
import type { FastifyInstance } from "fastify";
import pc from "picocolors";
import { withErrorHandling } from "../core/cliError.ts";
import { loadConfig } from "../core/config/config.ts";
import { log } from "../core/logger.ts";
import { listOperationsWithIds } from "../core/openapi/generate.ts";
import { loadOpenApiSpec } from "../core/openapi/loader.ts";
import { runGenerate } from "./generate.ts";
import { runInit } from "./init.ts";
import { runMock } from "./mock.ts";
import { runCollection } from "./run.ts";
import { runWorkflow } from "./workflow.ts";

// Testing note: @inquirer/prompts' select() reads arrow-key input in raw
// mode, which needs a real TTY — piped stdin (what CI/most test runners give
// a spawned process) can't drive it. A node-pty-based approach was tried to
// script real keystrokes against a pseudo-terminal, but node-pty's native
// binding doesn't work in this environment. So automated coverage here is
// intentionally two-tiered: pure logic (notEmpty, validPort,
// closeRunningServers) is unit-tested directly and exported for that
// purpose; the actual menu navigation only gets a launch/render smoke test
// (tests/integration/interactive.test.ts) and needs manual verification in a
// real terminal — the run/mock/generate functions it calls into are already
// covered by their own command-level tests.

// True-color helper for the brand accents (matches the logo's blue→violet
// gradient) — picocolors only ships fixed ANSI names, no arbitrary hex, and
// hand-rolling this avoids pulling in a whole chalk/ansis dependency for two
// colors. Resets the foreground only (\x1b[39m, not \x1b[0m) so it nests
// cleanly inside pc.bold()/pc.dim() without clobbering their SGR state, and
// is gated on pc.isColorSupported so it degrades the same way picocolors
// does for NO_COLOR / non-TTY / CI output.
function hex(color: string): (text: string) => string {
  if (!pc.isColorSupported) return (text) => text;
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return (text: string) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

const blue = hex("#3b82f6");
const violet = hex("#8b5cf6");

const theme: Partial<Theme> = {
  prefix: violet("shimwire ›"),
  style: {
    answer: (text: string) => pc.green(text),
    highlight: (text: string) => pc.bold(violet(text)),
    message: (text: string) => pc.bold(text),
    help: (text: string) => pc.dim(text),
    error: (text: string) => pc.red(text),
    defaultAnswer: (text: string) => pc.dim(`(${text})`),
    key: (text: string) => pc.bold(blue(`<${text}>`)),
  },
};

// select() has its own theme extension (description/cursor icon/help line)
// on top of the base Theme. Left unset, description falls back to
// @inquirer/select's hardcoded cyan (clashing with the rest of the brand
// palette), and both description and the "↑↓ navigate • ⏎ select" help line
// render glued directly under the choice list with no breathing room —
// select's own renderer joins them with '\n', not a blank line, and that
// layout isn't reachable through anything less than reimplementing these two
// style functions. keysHelpTip's body below matches the library default
// (see @inquirer/select/dist/index.js) plus a leading blank line.
const selectTheme = {
  ...theme,
  style: {
    ...theme.style,
    description: (text: string) => "\n" + blue(text),
    keysHelpTip: (keys: [string, string][]) =>
      "\n" + keys.map(([key, action]) => `${pc.bold(key)} ${pc.dim(action)}`).join(pc.dim(" • ")),
  },
};

// Pure so it's unit-testable without spinning up the prompt loop — same
// pattern as notEmpty/validPort below.
export function mcpConfigSnippet(): string {
  return JSON.stringify(
    { mcpServers: { shimwire: { command: "bunx", args: ["shimwire", "mcp"] } } },
    null,
    2
  );
}

export const notEmpty = (label: string) => (value: string) =>
  value.trim().length > 0 || `${label} can't be empty.`;

export function validPort(value: string): true | string {
  const port = Number(value);
  return (Number.isInteger(port) && port > 0 && port <= 65535) || "Enter a valid port (1-65535).";
}

// Servers started via "Mock" from the interactive menu keep running in the
// background so you can immediately "Run" a collection against them without
// leaving the menu; closed when you choose Exit.
export const runningServers: { port: number; app: FastifyInstance }[] = [];

// The most recently generated/selected collection, so choosing Run right
// after Generate doesn't make you re-type the path you just wrote.
let lastCollection: string | undefined;

function banner(): void {
  const tagline = pc.dim("mock an API, or test a real one");
  const status =
    runningServers.length > 0
      ? "\n" +
        pc.green("●") +
        pc.dim(` mock running on port${runningServers.length > 1 ? "s" : ""} `) +
        pc.green(runningServers.map((s) => s.port).join(", "))
      : "";

  console.log(
    boxen(tagline + status, {
      title: pc.bold(blue("shim") + violet("wire")),
      titleAlignment: "left",
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
      margin: { top: 1, bottom: 2, left: 0, right: 0 },
      borderStyle: "round",
      borderColor: "#8b5cf6",
    })
  );
}

function divider(): void {
  console.log("\n" + pc.dim("  " + "─".repeat(45)) + "\n");
}

async function pressEnterToContinue(): Promise<void> {
  console.log();
  await input({ message: "Press Enter to return to the menu...", theme });
}

function listCollections(): string[] {
  const dir = join(process.cwd(), ".shimwire", "collections");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".toml"));
}

function listWorkflows(): string[] {
  const dir = join(process.cwd(), ".shimwire", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".toml"));
}

async function promptGenerate(): Promise<void> {
  const config = (await loadConfig()).generate ?? {};

  const from = await input({
    message: "Spec path or URL:",
    default: config.from,
    theme,
    validate: notEmpty("Spec path"),
  });
  const out = await input({
    message: "Output collection path:",
    default: config.out ?? ".shimwire/collections/api.toml",
    theme,
    validate: notEmpty("Output path"),
  });
  const security = await input({
    message: "Preferred security scheme name (blank = auto-pick):",
    default: config.security ?? "",
    theme,
  });
  const allowLocal = await confirm({
    message: "Allow fetching from localhost/private-network URLs?",
    default: config.allow_local ?? false,
    theme,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification (self-signed local certs)?",
    default: config.insecure ?? false,
    theme,
  });

  await runGenerate({ from, out, security: security || undefined, allowLocal, insecure });
  lastCollection = out;

  const runNow = await confirm({
    message: `Run ${out} now?`,
    default: true,
    theme,
  });
  if (runNow) {
    divider();
    await promptRun(out);
  }
}

async function promptWorkflow(): Promise<void> {
  const config = (await loadConfig()).generate ?? {};

  const from = await input({
    message: "Spec path or URL:",
    default: config.from,
    theme,
    validate: notEmpty("Spec path"),
  });
  const allowLocal = await confirm({
    message: "Allow fetching from localhost/private-network URLs?",
    default: config.allow_local ?? false,
    theme,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification (self-signed local certs)?",
    default: config.insecure ?? false,
    theme,
  });

  divider();
  log.dim(`Loading OpenAPI spec from ${from}...`);
  const spec = await loadOpenApiSpec(from, { allowLocal, insecure });
  const operations = listOperationsWithIds(spec);

  if (operations.length === 0) {
    log.warn("This spec has no operations to pick from.");
    return;
  }

  const endpoints = await checkbox({
    message: "Which endpoints belong in this workflow?",
    theme: selectTheme,
    required: true,
    choices: operations.map(({ op, id }) => ({
      name: `${op.method.toUpperCase().padEnd(6)} ${op.path}  ${pc.dim(`(${id})`)}`,
      value: id,
    })),
  });

  const name = await input({
    message: "Workflow name:",
    default: "authentication_flow",
    theme,
    validate: notEmpty("Workflow name"),
  });

  divider();
  await runWorkflow({ from, name, endpoints, allowLocal, insecure });
}

async function promptMock(): Promise<void> {
  const config = (await loadConfig()).mock ?? {};

  const spec = await input({
    message: "Spec path or URL:",
    default: config.spec,
    theme,
    validate: notEmpty("Spec path"),
  });
  const port = await input({
    message: "Port:",
    default: String(config.port ?? 4000),
    theme,
    validate: validPort,
  });
  const allowLocal = await confirm({
    message: "Allow fetching from localhost/private-network URLs?",
    default: config.allow_local ?? false,
    theme,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification (self-signed local certs)?",
    default: config.insecure ?? false,
    theme,
  });
  const cors = await confirm({
    message: "Enable permissive CORS (for a browser frontend on another origin)?",
    default: config.cors ?? true,
    theme,
  });
  const watch = await confirm({
    message: "Show a live log line for every incoming request?",
    default: config.watch ?? true,
    theme,
  });

  divider();
  const app = await runMock(spec, { port, allowLocal, insecure, cors, watch });
  runningServers.push({ port: Number(port), app });
  log.dim('  Running in the background — pick "Run" to test it, or "Exit" to stop it.');
}

async function promptRun(preset?: string): Promise<void> {
  let collection = preset ?? lastCollection;

  if (!collection) {
    const collections = listCollections();
    const workflows = listWorkflows();
    if (collections.length > 0 || workflows.length > 0) {
      const choice = await select({
        message: "Which collection or workflow?",
        theme: selectTheme,
        choices: [
          // Full relative paths as values (not bare filenames) so a
          // collection and workflow sharing a filename can't resolve to the
          // wrong one — resolveCollectionPath tries the literal path first.
          ...collections.map((file) => ({
            name: file,
            value: join(".shimwire", "collections", file),
          })),
          ...(workflows.length > 0
            ? [
                new Separator("  ── workflows ──"),
                ...workflows.map((file) => ({
                  name: file,
                  value: join(".shimwire", "workflows", file),
                })),
              ]
            : []),
          new Separator(),
          { name: "(enter a path manually)", value: "__manual__" },
        ],
      });
      collection =
        choice === "__manual__"
          ? await input({
              message: "Collection path:",
              theme,
              validate: notEmpty("Collection path"),
            })
          : choice;
    } else {
      collection = await input({
        message: "Collection path:",
        theme,
        validate: notEmpty("Collection path"),
      });
    }
  }

  const env = await input({
    message: "Environment name:",
    default: "dev",
    theme,
    validate: notEmpty("Environment name"),
  });
  const only = await input({
    message: "Run only this request id (blank = all):",
    default: "",
    theme,
  });
  const failOnError = await confirm({
    message: "Exit with a non-zero code if any request fails?",
    default: false,
    theme,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification?",
    default: false,
    theme,
  });
  const report = await input({
    message: "Write an HTML report to (blank = skip):",
    default: "",
    theme,
  });

  divider();
  await runCollection(collection, {
    env,
    only: only || undefined,
    failOnError,
    insecure,
    report: report || undefined,
  });
  lastCollection = collection;
}

// Unlike Mock, `mcp` can't be launched from inside this menu — it hands its
// own stdio over to the MCP JSON-RPC transport, which would collide with
// inquirer's prompts reading the same stdin. So this is informational only:
// print the config snippet a client (Claude Desktop, Claude Code, etc.)
// needs, and point at how to run the server outside the menu.
async function promptMcpInfo(): Promise<void> {
  console.log(pc.bold("  Add shimwire as an MCP server:\n"));
  console.log(
    boxen(mcpConfigSnippet(), {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: "round",
      borderColor: "#8b5cf6",
    })
  );
  log.dim(
    "\n  Paste that into the client's MCP config, then it can call shimwire's\n" +
      "  spec/collection/workflow tools directly. Run it by hand with:\n" +
      pc.bold("    shimwire mcp")
  );
}

export async function closeRunningServers(): Promise<void> {
  if (runningServers.length === 0) return;
  log.dim(`\nStopping ${runningServers.length} mock server(s)...`);
  await Promise.all(runningServers.map(({ app }) => app.close()));
  runningServers.length = 0;
}

export function registerInteractiveCommand(program: Command): void {
  program
    .command("cli")
    .description(
      "Launch an interactive menu to run init/mock/generate/run without remembering flags"
    )
    .action(
      withErrorHandling(async () => {
        let first = true;

        for (;;) {
          if (!first) {
            await pressEnterToContinue();
            console.clear();
          }
          first = false;
          banner();

          const action = await select({
            message: "What do you want to do?",
            theme: selectTheme,
            choices: [
              {
                name: "🧪 Mock",
                value: "mock",
                description: "Serve fake-but-schema-valid responses from an OpenAPI/Swagger spec",
              },
              {
                name: "⚙️  Generate",
                value: "generate",
                description: "Auto-scaffold a runnable collection from a spec",
              },
              {
                name: "🔗 Workflow",
                value: "workflow",
                description: "Pick endpoints from a spec and save them as a reusable workflow",
              },
              {
                name: "▶️  Run",
                value: "run",
                description: "Run a collection against a real backend",
              },
              {
                name: "🛠️  Init",
                value: "init",
                description: "Scaffold a .shimwire/ project in this directory",
              },
              {
                name: "🔌 MCP",
                value: "mcp",
                description: "Show the config snippet to connect an AI client",
              },
              new Separator(),
              { name: "🚪 Exit", value: "exit" },
            ],
          });

          if (action === "exit") {
            await closeRunningServers();
            console.log(pc.dim("\n  Goodbye.\n"));
            return;
          }

          divider();
          try {
            if (action === "mock") await promptMock();
            else if (action === "generate") await promptGenerate();
            else if (action === "workflow") await promptWorkflow();
            else if (action === "run") await promptRun();
            else if (action === "init") await runInit();
            else if (action === "mcp") await promptMcpInfo();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Error: ${message}`);
          }
        }
      })
    );
}
