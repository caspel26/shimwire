import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { confirm, input, select, Separator } from "@inquirer/prompts";
import type { Theme } from "@inquirer/core";
import type { Command } from "commander";
import type { FastifyInstance } from "fastify";
import pc from "picocolors";
import { withErrorHandling } from "../core/cliError.ts";
import { loadConfig } from "../core/config/config.ts";
import { log } from "../core/logger.ts";
import { runGenerate } from "./generate.ts";
import { runInit } from "./init.ts";
import { runMock } from "./mock.ts";
import { runCollection } from "./run.ts";

const theme: Partial<Theme> = {
  prefix: pc.cyan("shimwire ›"),
  style: {
    answer: (text: string) => pc.green(text),
    highlight: (text: string) => pc.cyan(text),
    message: (text: string) => pc.bold(text),
    help: (text: string) => pc.dim(text),
    error: (text: string) => pc.red(text),
    defaultAnswer: (text: string) => pc.dim(`(${text})`),
    key: (text: string) => pc.cyan(pc.bold(`<${text}>`)),
  },
};

export const notEmpty = (label: string) => (value: string) =>
  value.trim().length > 0 || `${label} can't be empty.`;

export function validPort(value: string): true | string {
  const port = Number(value);
  return (Number.isInteger(port) && port > 0 && port <= 65535) || "Enter a valid port (1-65535).";
}

// Servers started via "Mock" from the interactive menu keep running in the
// background so you can immediately "Run" a collection against them without
// leaving the menu; closed when you choose Exit.
const runningServers: { port: number; app: FastifyInstance }[] = [];

// The most recently generated/selected collection, so choosing Run right
// after Generate doesn't make you re-type the path you just wrote.
let lastCollection: string | undefined;

function banner(): void {
  console.log();
  console.log(pc.bold(pc.cyan("  ▸ shimwire")) + pc.dim("  — mock an API, or test a real one"));
  if (runningServers.length > 0) {
    const ports = runningServers.map((s) => s.port).join(", ");
    console.log(pc.dim(`  mock server(s) running on port(s): ${ports}`));
  }
  console.log(pc.dim("  ─────────────────────────────────────────────"));
}

function divider(): void {
  console.log(pc.dim("  ─────────────────────────────────────────────"));
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

  divider();
  const app = await runMock(spec, { port, allowLocal, insecure, cors });
  runningServers.push({ port: Number(port), app });
  log.dim('  Running in the background — pick "Run" to test it, or "Exit" to stop it.');
}

async function promptRun(preset?: string): Promise<void> {
  let collection = preset ?? lastCollection;

  if (!collection) {
    const collections = listCollections();
    if (collections.length > 0) {
      const choice = await select({
        message: "Which collection?",
        theme,
        choices: [
          ...collections.map((file) => ({ name: file, value: file })),
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

async function closeRunningServers(): Promise<void> {
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

          console.log();
          const action = await select({
            message: "What do you want to do?",
            theme,
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
                name: "▶️  Run",
                value: "run",
                description: "Run a collection against a real backend",
              },
              {
                name: "🛠️  Init",
                value: "init",
                description: "Scaffold a .shimwire/ project in this directory",
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
            else if (action === "run") await promptRun();
            else if (action === "init") await runInit();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Error: ${message}`);
          }
        }
      })
    );
}
