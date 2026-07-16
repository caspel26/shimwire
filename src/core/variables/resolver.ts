import { faker } from "@faker-js/faker";
import type { Environment } from "../collection/types.ts";

export interface StepResult {
  status: number;
  response: unknown;
}

export interface ResolverContext {
  env: Environment;
  steps: Record<string, StepResult>;
}

export class VariableResolutionError extends Error {}

const PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function getFakerValue(path: string): unknown {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = faker;
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) {
      throw new VariableResolutionError(`Unknown faker path "faker.${path}"`);
    }
  }
  if (typeof node !== "function") {
    throw new VariableResolutionError(`"faker.${path}" is not callable`);
  }
  return node();
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = obj;
  for (const part of parts) {
    if (node === undefined || node === null) return undefined;
    node = node[part];
  }
  return node;
}

function resolveExpression(expr: string, ctx: ResolverContext): unknown {
  if (expr.startsWith("env.")) {
    const key = expr.slice("env.".length);
    if (!(key in ctx.env)) {
      throw new VariableResolutionError(`Unknown environment variable "env.${key}"`);
    }
    return ctx.env[key];
  }

  if (expr.startsWith("faker.")) {
    return getFakerValue(expr.slice("faker.".length));
  }

  if (expr.startsWith("steps.")) {
    const rest = expr.slice("steps.".length);
    const [stepId, ...pathParts] = rest.split(".");
    const step = stepId ? ctx.steps[stepId] : undefined;
    if (!step) {
      throw new VariableResolutionError(`Unknown or not-yet-run step "steps.${stepId}"`);
    }
    const value = getByPath(step, pathParts.join("."));
    if (value === undefined) {
      throw new VariableResolutionError(`Path "steps.${rest}" resolved to undefined`);
    }
    return value;
  }

  throw new VariableResolutionError(
    `Unsupported variable "{{${expr}}}" — only env., faker., and steps. prefixes are supported`
  );
}

export function resolveString(input: string, ctx: ResolverContext): string {
  return input.replace(PLACEHOLDER_RE, (_match, expr: string) =>
    String(resolveExpression(expr, ctx))
  );
}

export function resolveValue(input: unknown, ctx: ResolverContext): unknown {
  if (typeof input === "string") {
    const trimmed = input.trim();
    const fullMatch = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (fullMatch && fullMatch[1] !== undefined) {
      return resolveExpression(fullMatch[1], ctx);
    }
    return resolveString(input, ctx);
  }
  if (Array.isArray(input)) {
    return input.map((item) => resolveValue(item, ctx));
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = resolveValue(value, ctx);
    }
    return out;
  }
  return input;
}
