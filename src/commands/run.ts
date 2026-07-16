import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { filterToTarget, topologicalSort } from "../core/collection/depGraph.ts";
import { loadCollection, loadEnvironment } from "../core/collection/parser.ts";
import { executeStep } from "../core/executor/httpClient.ts";
import { formatError, formatResult } from "../core/executor/formatter.ts";
import { resolveString, type StepResult } from "../core/variables/resolver.ts";

interface RunOptions {
  env: string;
  only?: string;
  failOnError?: boolean;
  insecure?: boolean;
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
    .action(async (collectionArg: string, options: RunOptions) => {
      const collectionPath = resolveCollectionPath(collectionArg);
      const envPath = resolveEnvPath(options.env);

      const collection = await loadCollection(collectionPath);
      const env = await loadEnvironment(envPath);

      let steps = topologicalSort(collection.request);
      if (options.only) {
        steps = filterToTarget(steps, options.only);
      }

      const stepResults: Record<string, StepResult> = {};
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
          console.log(formatResult(result));
          if (!result.ok) anyFailed = true;
        } catch (err) {
          anyFailed = true;
          const message = err instanceof Error ? err.message : String(err);
          console.log(formatError(step.id, message));
        }
      }

      if (anyFailed && options.failOnError) {
        process.exitCode = 1;
      } else if (anyFailed) {
        console.log(
          pc.yellow("\nOne or more requests failed (use --fail-on-error to exit non-zero in CI)")
        );
      }
    });
}
