import type { Collection, Environment } from "../collection/types.ts";
import type { StepResult } from "../variables/resolver.ts";
import { filterToTarget, topologicalSort } from "../collection/depGraph.ts";
import { resolveString } from "../variables/resolver.ts";
import { executeStep } from "./httpClient.ts";
import { formatError, formatResult } from "./formatter.ts";
import { toReportEntry, type ReportEntry } from "./htmlReport.ts";

export interface ExecuteCollectionOptions {
  only?: string;
  insecure?: boolean;
  /** Called after each step with its report entry and a pre-formatted
   *  terminal line — lets the CLI stream progress live while the MCP tool
   *  (which has no terminal to stream to) can just ignore it and use the
   *  final reportEntries array. */
  onStep?: (entry: ReportEntry, formatted: string) => void;
}

export interface ExecuteCollectionResult {
  reportEntries: ReportEntry[];
  anyFailed: boolean;
}

// Shared by `shimwire run` (streams formatted lines to the terminal, then
// exits non-zero on failure if asked) and the MCP run_collection tool
// (wants the same execution but as structured data to hand back to an AI
// client, not console output) — same core loop, two different consumers.
export async function executeCollection(
  collection: Collection,
  env: Environment,
  options: ExecuteCollectionOptions = {}
): Promise<ExecuteCollectionResult> {
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
      const entry = toReportEntry(result);
      reportEntries.push(entry);
      if (!result.ok) anyFailed = true;
      options.onStep?.(entry, formatResult(result));
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      const entry: ReportEntry = {
        id: step.id,
        method: step.method,
        path: step.path,
        ok: false,
        error: message,
      };
      reportEntries.push(entry);
      options.onStep?.(entry, formatError(step.id, message));
    }
  }

  return { reportEntries, anyFailed };
}
