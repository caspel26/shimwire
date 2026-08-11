import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

export async function loadEnvironment(path: string): Promise<Environment> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = EnvironmentSchema.safeParse(parsed);
  if (!result.success) {
    throw new CollectionParseError(formatZodError(result.error, path));
  }
  return result.data;
}
