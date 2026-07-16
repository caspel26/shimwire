import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { confirm, input, select } from "@inquirer/prompts";
import type { Command } from "commander";
import { withErrorHandling } from "../core/cliError.ts";
import { loadConfig } from "../core/config/config.ts";
import { log } from "../core/logger.ts";
import { runGenerate } from "./generate.ts";
import { runInit } from "./init.ts";
import { runMock } from "./mock.ts";
import { runCollection } from "./run.ts";

function listCollections(): string[] {
  const dir = join(process.cwd(), ".shimwire", "collections");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".toml"));
}

async function promptGenerate(): Promise<void> {
  const config = (await loadConfig()).generate ?? {};

  const from = await input({ message: "Spec path or URL:", default: config.from });
  const out = await input({
    message: "Output collection path:",
    default: config.out ?? ".shimwire/collections/api.toml",
  });
  const security = await input({
    message: "Preferred security scheme name (blank = auto-pick):",
    default: config.security ?? "",
  });
  const allowLocal = await confirm({
    message: "Allow fetching from localhost/private-network URLs?",
    default: config.allow_local ?? false,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification (self-signed local certs)?",
    default: config.insecure ?? false,
  });

  await runGenerate({ from, out, security: security || undefined, allowLocal, insecure });
}

async function promptMock(): Promise<void> {
  const config = (await loadConfig()).mock ?? {};

  const spec = await input({ message: "Spec path or URL:", default: config.spec });
  const port = await input({ message: "Port:", default: String(config.port ?? 4000) });
  const allowLocal = await confirm({
    message: "Allow fetching from localhost/private-network URLs?",
    default: config.allow_local ?? false,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification (self-signed local certs)?",
    default: config.insecure ?? false,
  });
  const cors = await confirm({
    message: "Enable permissive CORS (for a browser frontend on another origin)?",
    default: config.cors ?? true,
  });

  log.dim("\nStarting the mock server — it'll keep running until you Ctrl+C.");
  await runMock(spec, { port, allowLocal, insecure, cors });
}

async function promptRun(): Promise<void> {
  const collections = listCollections();

  let collection: string;
  if (collections.length > 0) {
    collection = await select({
      message: "Which collection?",
      choices: [
        ...collections.map((file) => ({ name: file, value: file })),
        { name: "(enter a path manually)", value: "__manual__" },
      ],
    });
    if (collection === "__manual__") {
      collection = await input({ message: "Collection path:" });
    }
  } else {
    collection = await input({ message: "Collection path:" });
  }

  const env = await input({ message: "Environment name:", default: "dev" });
  const only = await input({ message: "Run only this request id (blank = all):", default: "" });
  const failOnError = await confirm({
    message: "Exit with a non-zero code if any request fails?",
    default: false,
  });
  const insecure = await confirm({
    message: "Skip TLS certificate verification?",
    default: false,
  });
  const report = await input({
    message: "Write an HTML report to (blank = skip):",
    default: "",
  });

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
        for (;;) {
          const action = await select({
            message: "What do you want to do?",
            choices: [
              { name: "Mock an API from a spec", value: "mock" },
              { name: "Generate a collection from a spec", value: "generate" },
              { name: "Run a collection", value: "run" },
              { name: "Initialize a project (.shimwire/)", value: "init" },
              { name: "Exit", value: "exit" },
            ],
          });

          if (action === "exit") return;

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

          log.info("");
        }
      })
    );
}
