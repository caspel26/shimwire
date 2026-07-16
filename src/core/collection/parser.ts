import { readFile } from "node:fs/promises";
import * as toml from "smol-toml";
import { ZodError } from "zod";
import { CollectionSchema, EnvironmentSchema, type Collection, type Environment } from "./types.ts";

export class CollectionParseError extends Error {}

function formatZodError(err: ZodError, source: string): string {
  const issues = err.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return `Invalid ${source}:\n${issues}`;
}

export async function loadCollection(path: string): Promise<Collection> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = CollectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new CollectionParseError(formatZodError(result.error, path));
  }

  const ids = new Set<string>();
  for (const step of result.data.request) {
    if (ids.has(step.id)) {
      throw new CollectionParseError(`Invalid ${path}:\n  - duplicate request id "${step.id}"`);
    }
    ids.add(step.id);
  }
  for (const step of result.data.request) {
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) {
        throw new CollectionParseError(
          `Invalid ${path}:\n  - request "${step.id}" depends_on unknown id "${dep}"`
        );
      }
    }
  }

  return result.data;
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
