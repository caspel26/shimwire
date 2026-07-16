import type { Auth, RequestStep } from "../collection/types.ts";
import type { ResolverContext, StepResult } from "../variables/resolver.ts";
import { resolveString, resolveValue } from "../variables/resolver.ts";

export interface ExecutedRequest extends StepResult {
  id: string;
  method: string;
  path: string;
  durationMs: number;
  ok: boolean;
}

function applyAuth(headers: Headers, auth: Auth): void {
  if (auth.type === "bearer") {
    headers.set("Authorization", `Bearer ${auth.token}`);
  } else if (auth.type === "basic") {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    headers.set("Authorization", `Basic ${encoded}`);
  } else if (auth.type === "apiKey") {
    headers.set(auth.header, auth.value);
  }
}

export async function executeStep(
  step: RequestStep,
  baseUrl: string,
  ctx: ResolverContext
): Promise<ExecutedRequest> {
  const resolvedPath = resolveString(step.path, ctx);
  const url = new URL(resolvedPath, baseUrl);

  const headers = new Headers();
  for (const [key, value] of Object.entries(step.headers ?? {})) {
    headers.set(key, resolveString(value, ctx));
  }
  if (step.auth) {
    applyAuth(headers, step.auth);
  }

  let body: string | undefined;
  if (step.body !== undefined) {
    const resolvedBody = resolveValue(step.body, ctx);
    body = JSON.stringify(resolvedBody);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const start = performance.now();
  const res = await fetch(url, { method: step.method, headers, body });
  const durationMs = performance.now() - start;

  const contentType = res.headers.get("content-type") ?? "";
  const response = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text();

  return {
    id: step.id,
    method: step.method,
    path: resolvedPath,
    status: res.status,
    response,
    durationMs,
    ok: res.ok,
  };
}
