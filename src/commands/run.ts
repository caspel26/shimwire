import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { filterToTarget, topologicalSort } from "../core/collection/depGraph.ts";
import { loadCollection, loadEnvironment } from "../core/collection/parser.ts";
import { withErrorHandling } from "../core/cliError.ts";
import { loadConfig } from "../core/config/config.ts";
import { executeStep } from "../core/executor/httpClient.ts";
import { formatError, formatResult } from "../core/executor/formatter.ts";
import { renderHtmlReport, toReportEntry, type ReportEntry } from "../core/executor/htmlReport.ts";
import { log } from "../core/logger.ts";
import { resolveString, type StepResult } from "../core/variables/resolver.ts";

export interface RunOptions {
  env: string;
  only?: string;
  failOnError?: boolean;
  insecure?: boolean;
  report?: string;
}

function resolveCollectionPath(input: string): string {
  if (existsSync(input)) return input;
  const scoped = join(process.cwd(), ".shimwire", "collections", input);
  if (existsSync(scoped)) return scoped;
  throw new Error(`Collection not found: ${input}`);
}

function resolveEnvPath(name: string): string {
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

  const collection = await loadCollection(collectionPath);
  const env = await loadEnvironment(envPath);

  let steps = topologicalSort(collection.request);
  if (options.only) {
    steps = filterToTarget(steps, options.only);
  }

  const stepResults: Record<string, StepResult> = {};
  const reportEntries: ReportEntry[] = [];
  let anyFailed = false;
  const baseUrl = resolveString(collection.meta.base_url, { env, steps: stepResults });

  for (const step of steps) {
    try {
      const result = await executeStep(
        step,
        baseUrl,
        { env, steps: stepResults },
        { insecure: options.insecure }
      );
      stepResults[step.id] = { status: result.status, response: result.response };
      log.info(formatResult(result));
      reportEntries.push(toReportEntry(result));
      if (!result.ok) anyFailed = true;
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      log.info(formatError(step.id, message));
      reportEntries.push({
        id: step.id,
        method: step.method,
        path: step.path,
        ok: false,
        error: message,
      });
    }
  }

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
    .description("Run a request collection against a real backend")
    .argument(
      "<collection>",
      "path to a collection .toml file (or a name under .shimwire/collections/)"
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
