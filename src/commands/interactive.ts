import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { confirm, input, select, Separator } from "@inquirer/prompts";
import type { Theme } from "@inquirer/core";
import type { Command } from "commander";
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

function banner(): void {
  console.log();
  console.log(pc.bold(pc.cyan("  shimwire")) + pc.dim("  — mock an API, or test a real one"));
  console.log(pc.dim("  ─────────────────────────────────────────────"));
}

function divider(): void {
  console.log(pc.dim("  ─────────────────────────────────────────────"));
}

function listCollections(): string[] {
  const dir = join(process.cwd(), ".shimwire", "collections");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".toml"));
}

async function promptGenerate(): Promise<void> {
  const config = (await loadConfig()).generate ?? {};

  const from = await input({ message: "Spec path or URL:", default: config.from, theme });
  const out = await input({
    message: "Output collection path:",
    default: config.out ?? ".shimwire/collections/api.toml",
    theme,
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
}

async function promptMock(): Promise<void> {
  const config = (await loadConfig()).mock ?? {};

  const spec = await input({ message: "Spec path or URL:", default: config.spec, theme });
  const port = await input({ message: "Port:", default: String(config.port ?? 4000), theme });
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
  log.dim("  Starting the mock server — it'll keep running until you Ctrl+C.");
  await runMock(spec, { port, allowLocal, insecure, cors });
}

async function promptRun(): Promise<void> {
  const collections = listCollections();

  let collection: string;
  if (collections.length > 0) {
    collection = await select({
      message: "Which collection?",
      theme,
      choices: [
        ...collections.map((file) => ({ name: file, value: file })),
        new Separator(),
        { name: "(enter a path manually)", value: "__manual__" },
      ],
    });
    if (collection === "__manual__") {
      collection = await input({ message: "Collection path:", theme });
    }
  } else {
    collection = await input({ message: "Collection path:", theme });
  }

  const env = await input({ message: "Environment name:", default: "dev", theme });
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
}

export function registerInteractiveCommand(program: Command): void {
  program
    .command("cli")
    .description(
      "Launch an interactive menu to run init/mock/generate/run without remembering flags"
    )
    .action(
      withErrorHandling(async () => {
        banner();

        for (;;) {
          console.log();
          const action = await select({
            message: "What do you want to do?",
            theme,
            choices: [
              {
                name: "Mock",
                value: "mock",
                description: "Serve fake-but-schema-valid responses from an OpenAPI/Swagger spec",
              },
              {
                name: "Generate",
                value: "generate",
                description: "Auto-scaffold a runnable collection from a spec",
              },
              {
                name: "Run",
                value: "run",
                description: "Run a collection against a real backend",
              },
              {
                name: "Init",
                value: "init",
                description: "Scaffold a .shimwire/ project in this directory",
              },
              new Separator(),
              { name: "Exit", value: "exit" },
            ],
          });

          if (action === "exit") {
            console.log(pc.dim("\n  Goodbye.\n"));
            return;
          }

          divider();
          try {
            if (action === "mock") {
              await promptMock();
              return; // mock keeps the server listening; nothing left to loop back to
            } else if (action === "generate") {
              await promptGenerate();
            } else if (action === "run") {
              await promptRun();
            } else if (action === "init") {
              await runInit();
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Error: ${message}`);
          }
        }
      })
    );
}
