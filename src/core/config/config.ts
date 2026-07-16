import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as toml from "smol-toml";
import { z } from "zod";

const GenerateConfigSchema = z.object({
  from: z.string().optional(),
  out: z.string().optional(),
  security: z.string().optional(),
  allow_local: z.boolean().optional(),
  insecure: z.boolean().optional(),
});

const RunConfigSchema = z.object({
  report: z.string().optional(),
});

const MockConfigSchema = z.object({
  spec: z.string().optional(),
  port: z.union([z.string(), z.number()]).optional(),
  overrides: z.string().optional(),
  allow_local: z.boolean().optional(),
  insecure: z.boolean().optional(),
  cors: z.boolean().optional(),
});

const ConfigSchema = z.object({
  generate: GenerateConfigSchema.optional(),
  run: RunConfigSchema.optional(),
  mock: MockConfigSchema.optional(),
});

export type ShimwireConfig = z.infer<typeof ConfigSchema>;

/** Reads .shimwire/config.toml for per-project command defaults. CLI flags
 *  always take precedence over anything set here. Missing file -> {}. */
export async function loadConfig(cwd: string = process.cwd()): Promise<ShimwireConfig> {
  const path = join(cwd, ".shimwire", "config.toml");
  if (!existsSync(path)) return {};

  const raw = await readFile(path, "utf8");
  return ConfigSchema.parse(toml.parse(raw));
}
