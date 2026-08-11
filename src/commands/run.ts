import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { loadEnvironment, loadRunnable } from "../core/collection/parser.ts";
import { withErrorHandling } from "../core/cliError.ts";
import { loadConfig } from "../core/config/config.ts";
import { executeCollection } from "../core/executor/collectionRunner.ts";
import { renderHtmlReport } from "../core/executor/htmlReport.ts";
import { log } from "../core/logger.ts";

export interface RunOptions {
  env: string;
  only?: string;
  failOnError?: boolean;
  insecure?: boolean;
  report?: string;
}

export function resolveCollectionPath(input: string): string {
  if (existsSync(input)) return input;
  const scopedCollection = join(process.cwd(), ".shimwire", "collections", input);
  if (existsSync(scopedCollection)) return scopedCollection;
  const scopedWorkflow = join(process.cwd(), ".shimwire", "workflows", input);
  if (existsSync(scopedWorkflow)) return scopedWorkflow;
  throw new Error(
    `Collection or workflow not found: ${input} (checked .shimwire/collections/ and .shimwire/workflows/)`
  );
}

export function resolveEnvPath(name: string): string {
  const path = join(process.cwd(), ".shimwire", "env", `${name}.toml`);
  if (!existsSync(path)) {
    throw new Error(`Environment not found: ${path}`);
  }
  return path;
}

export async function runCollection(collectionArg: string, options: RunOptions): Promise<void> {
  const config = (await loadConfig()).run ?? {};
  const report = options.report ?? config.report;

  const collectionPath = resolveCollectionPath(collectionArg);
  const envPath = resolveEnvPath(options.env);

  const collection = await loadRunnable(collectionPath);
  const env = await loadEnvironment(envPath);

  const { reportEntries, anyFailed } = await executeCollection(collection, env, {
    only: options.only,
    insecure: options.insecure,
    onStep: (_entry, formatted) => log.info(formatted),
  });

  if (report) {
    const html = renderHtmlReport(reportEntries, { collection: collectionPath, env: options.env });
    await mkdir(dirname(report), { recursive: true });
    await writeFile(report, html);
    log.dim(`\nReport written to ${report}`);
  }

  if (anyFailed && options.failOnError) {
    process.exitCode = 1;
  } else if (anyFailed) {
    log.warn("\nOne or more requests failed (use --fail-on-error to exit non-zero in CI)");
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run a request collection (or a standalone workflow) against a real backend")
    .argument(
      "<collection>",
      "path to a collection or workflow .toml file (or a name under .shimwire/collections/ or .shimwire/workflows/)"
    )
    .option(
      "-e, --env <name>",
      "environment to use (looked up under .shimwire/env/<name>.toml)",
      "dev"
    )
    .option("--only <id>", "run only this request and its dependencies")
    .option("--fail-on-error", "exit non-zero if any request fails", false)
    .option(
      "-k, --insecure",
      "skip TLS certificate verification (self-signed/local dev certs)",
      false
    )
    .option(
      "-r, --report <path>",
      "write an HTML report with full request/response detail for every step (sensitive headers redacted); overrides .shimwire/config.toml [run].report"
    )
    .action(withErrorHandling(runCollection));
}
