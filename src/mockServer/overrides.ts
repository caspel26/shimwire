import { readFile } from "node:fs/promises";
import * as toml from "smol-toml";
import { z } from "zod";

const OverrideEntrySchema = z.object({
  path: z.string().min(1),
  method: z.string().min(1),
  status: z.number().int().optional(),
  latency_ms: z.number().int().nonnegative().optional(),
  when: z.string().optional(),
  body: z.unknown().optional(),
});

const OverridesFileSchema = z.object({
  override: z.array(OverrideEntrySchema).default([]),
});

export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;

export async function loadOverrides(path: string): Promise<OverrideEntry[]> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = OverridesFileSchema.parse(parsed);
  return result.override;
}

function evaluateWhen(when: string | undefined, params: Record<string, string>): boolean {
  if (!when) return true;
  const match = when.match(/^\s*(\w+)\s*==\s*['"](.*)['"]\s*$/);
  if (!match) return false;
  const [, key, expected] = match;
  return key !== undefined && params[key] === expected;
}

export function findOverride(
  overrides: OverrideEntry[],
  method: string,
  path: string,
  params: Record<string, string>
): OverrideEntry | undefined {
  return overrides.find(
    (entry) =>
      entry.method.toUpperCase() === method.toUpperCase() &&
      entry.path === path &&
      evaluateWhen(entry.when, params)
  );
}
