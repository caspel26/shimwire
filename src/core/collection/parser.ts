import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as toml from "smol-toml";
import { ZodError } from "zod";
import {
  CollectionSchema,
  EnvironmentSchema,
  WorkflowSchema,
  type Collection,
  type Environment,
  type RequestStep,
  type Workflow,
} from "./types.ts";

export class CollectionParseError extends Error {}

function formatZodError(err: ZodError, source: string): string {
  const issues = err.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return `Invalid ${source}:\n${issues}`;
}

function validateIds(path: string, requests: RequestStep[]): void {
  const ids = new Set<string>();
  for (const step of requests) {
    if (ids.has(step.id)) {
      throw new CollectionParseError(`Invalid ${path}:\n  - duplicate request id "${step.id}"`);
    }
    ids.add(step.id);
  }
  for (const step of requests) {
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) {
        throw new CollectionParseError(
          `Invalid ${path}:\n  - request "${step.id}" depends_on unknown id "${dep}"`
        );
      }
    }
  }
}

export async function loadWorkflow(path: string): Promise<Workflow> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = WorkflowSchema.safeParse(parsed);
  if (!result.success) {
    throw new CollectionParseError(formatZodError(result.error, path));
  }
  return result.data;
}

export async function loadCollection(path: string): Promise<Collection> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = CollectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new CollectionParseError(formatZodError(result.error, path));
  }

  // Included workflows run before the collection's own requests by
  // default — filterToTarget/topologicalSort still order everything by
  // depends_on where it's declared, this just sets the array-order tiebreak
  // for steps that don't explicitly depend on anything.
  let requests = result.data.request;
  for (const name of result.data.meta.include ?? []) {
    const workflowPath = join(process.cwd(), ".shimwire", "workflows", `${name}.toml`);
    let workflow: Workflow;
    try {
      workflow = await loadWorkflow(workflowPath);
    } catch (err) {
      if (err instanceof CollectionParseError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new CollectionParseError(
        `Invalid ${path}:\n  - couldn't load included workflow "${name}" (${workflowPath}): ${message}`
      );
    }
    requests = [...workflow.request, ...requests];
  }

  validateIds(path, requests);

  return { ...result.data, request: requests };
}

// A workflow file is just a request list — no [meta]/base_url of its own —
// so it can't be run directly the way a collection can, `run` needs
// *something* to resolve {{env.base_url}} against. `loadRunnable` detects
// which shape a given file actually is (by whether it has a [meta] table)
// and synthesizes a minimal Collection for a bare workflow, giving it
// {{env.base_url}} the same as any hand-written collection would have —
// this is what makes `shimwire run authentication_flow.toml` work without
// wrapping every workflow in a throwaway collection just to run it standalone.
export async function loadRunnable(path: string): Promise<Collection> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const isCollection =
    typeof parsed === "object" && parsed !== null && "meta" in (parsed as Record<string, unknown>);
  if (isCollection) {
    return loadCollection(path);
  }

  const workflow = await loadWorkflow(path);
  validateIds(path, workflow.request);
  return {
    meta: { name: basename(path).replace(/\.toml$/, ""), base_url: "{{env.base_url}}" },
    request: workflow.request,
  };
}

export async function loadEnvironment(path: string): Promise<Environment> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = EnvironmentSchema.safeParse(parsed);
  if (!result.success) {
    throw new CollectionParseError(formatZodError(result.error, path));
  }
  return result.data;
}
