import { readFile } from "node:fs/promises";
import * as toml from "smol-toml";
import { z } from "zod";

const SequenceStepSchema = z.object({
  status: z.number().int().optional(),
  latency_ms: z.number().int().nonnegative().optional(),
  body: z.unknown().optional(),
});

const OverrideEntrySchema = z
  .object({
    path: z.string().min(1).optional(),
    path_regex: z.string().min(1).optional(),
    method: z.string().min(1),
    status: z.number().int().optional(),
    latency_ms: z.number().int().nonnegative().optional(),
    when: z.string().optional(),
    body: z.unknown().optional(),
    sequence: z.array(SequenceStepSchema).min(1).optional(),
    sequence_mode: z.enum(["repeat_last", "cycle"]).default("repeat_last"),
  })
  .refine((entry) => Boolean(entry.path) !== Boolean(entry.path_regex), {
    message: "override needs exactly one of `path` or `path_regex`",
  })
  .refine((entry) => !entry.sequence || (entry.status === undefined && entry.body === undefined), {
    message:
      "override can't combine `sequence` with top-level `status`/`body` — put them in the sequence steps instead",
  });

const OverridesFileSchema = z.object({
  override: z.array(OverrideEntrySchema).default([]),
});

// Input type, not the parsed output type: `sequence_mode` has a zod
// `.default()`, so hand-constructed OverrideEntry values (tests, callers
// that skip loadOverrides' TOML parse) shouldn't be forced to spell it out
// — resolveOverrideResponse treats a missing sequence_mode exactly like
// "repeat_last" already, same as the default zod would have filled in.
export type OverrideEntry = z.input<typeof OverrideEntrySchema>;
export type SequenceStep = z.infer<typeof SequenceStepSchema>;

export async function loadOverrides(path: string): Promise<OverrideEntry[]> {
  const raw = await readFile(path, "utf8");
  const parsed = toml.parse(raw);
  const result = OverridesFileSchema.parse(parsed);
  return result.override;
}

// `path`/`path_regex` are matched against the OpenAPI path *template*
// (e.g. "/users/{id}"), not the literal request URL — so "{id}" is already
// handled for free by the exact-match case. `*` in a `path` template
// matches exactly one segment (like the literal "{id}" it's standing in
// for); `**` matches any number of segments. `path_regex` is an escape
// hatch for anything a glob can't express, matched as a full (^...$) regex
// against the same template string.
const globCache = new WeakMap<OverrideEntry, RegExp>();

function globToRegExp(template: string): RegExp {
  const pattern = template
    .split("/")
    .map((segment) =>
      segment === "**"
        ? ".*"
        : segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

function pathMatches(entry: OverrideEntry, pathTemplate: string): boolean {
  if (entry.path_regex) {
    let regex = globCache.get(entry);
    if (!regex) {
      regex = new RegExp(`^${entry.path_regex}$`);
      globCache.set(entry, regex);
    }
    return regex.test(pathTemplate);
  }

  const path = entry.path;
  if (!path) return false;
  if (!path.includes("*")) return path === pathTemplate;

  let regex = globCache.get(entry);
  if (!regex) {
    regex = globToRegExp(path);
    globCache.set(entry, regex);
  }
  return regex.test(pathTemplate);
}

export interface WhenContext {
  params: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

// `when` supports `key == 'value'` where `key` is a bare path param name
// (backward-compatible), or prefixed as `query.<name>` / `header.<name>` to
// match a query string value or a request header (matched case-insensitively,
// same as HTTP itself).
function evaluateWhen(when: string | undefined, context: WhenContext): boolean {
  if (!when) return true;
  const match = when.match(/^\s*([\w.-]+)\s*==\s*['"](.*)['"]\s*$/);
  if (!match) return false;
  const [, rawKey, expected] = match;
  if (!rawKey) return false;

  let actual: string | undefined;
  if (rawKey.startsWith("query.")) {
    actual = context.query?.[rawKey.slice("query.".length)];
  } else if (rawKey.startsWith("header.")) {
    actual = context.headers?.[rawKey.slice("header.".length).toLowerCase()];
  } else {
    actual = context.params[rawKey];
  }
  return actual === expected;
}

export function findOverride(
  overrides: OverrideEntry[],
  method: string,
  pathTemplate: string,
  context: WhenContext
): OverrideEntry | undefined {
  return overrides.find(
    (entry) =>
      entry.method.toUpperCase() === method.toUpperCase() &&
      pathMatches(entry, pathTemplate) &&
      evaluateWhen(entry.when, context)
  );
}

// Advances (and reads) the per-entry sequence counter. Counter state lives
// here, keyed by object identity, so it survives across requests for the
// life of one mock server instance (a fresh `loadOverrides()` call — e.g.
// each `shimwire mock` startup — produces fresh entry objects, so state
// never leaks between runs) but needs no explicit teardown.
const sequenceCounters = new WeakMap<OverrideEntry, number>();

export interface ResolvedOverride {
  status?: number;
  latency_ms?: number;
  body?: unknown;
}

export function resolveOverrideResponse(entry: OverrideEntry): ResolvedOverride {
  if (!entry.sequence || entry.sequence.length === 0) {
    return { status: entry.status, latency_ms: entry.latency_ms, body: entry.body };
  }

  const call = sequenceCounters.get(entry) ?? 0;
  sequenceCounters.set(entry, call + 1);

  const index =
    entry.sequence_mode === "cycle"
      ? call % entry.sequence.length
      : Math.min(call, entry.sequence.length - 1);

  return entry.sequence[index] as ResolvedOverride;
}
