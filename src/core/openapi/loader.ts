import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";

export class OpenApiLoadError extends Error {}

export interface LoadOpenApiSpecOptions {
  /** Allow fetching specs from localhost/private-network URLs. swagger-parser
   *  blocks these by default as an SSRF guard; shimwire's primary use case
   *  (local dev servers) routinely needs it, so it's an explicit opt-in. */
  allowLocal?: boolean;
  /** Skip TLS certificate verification while fetching the spec (self-signed
   *  local dev certs). swagger-parser's HTTP resolver calls the global
   *  `fetch` directly with no per-call TLS option, so this works by
   *  temporarily wrapping `globalThis.fetch` for the duration of the load —
   *  broader blast radius than shimwire's own `--insecure` on `run`, since
   *  it affects any HTTPS call made during that window, not just this one.
   *  Explicit opt-in only. */
  insecure?: boolean;
}

async function withInsecureFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    originalFetch(input, {
      ...init,
      tls: { rejectUnauthorized: false },
    } as RequestInit)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function loadOpenApiSpec(
  path: string,
  options: LoadOpenApiSpecOptions = {}
): Promise<OpenAPIV3.Document> {
  const resolveOptions = options.allowLocal
    ? { resolve: { http: { safeUrlResolver: false } } }
    : {};
  const dereference = () => SwaggerParser.dereference(path, resolveOptions);

  try {
    const api = options.insecure ? await withInsecureFetch(dereference) : await dereference();
    return api as OpenAPIV3.Document;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OpenApiLoadError(`Failed to load OpenAPI spec at "${path}": ${message}`);
  }
}

export interface RouteOperation {
  path: string;
  method: string;
  operation: OpenAPIV3.OperationObject;
}

export function listOperations(spec: OpenAPIV3.Document): RouteOperation[] {
  const operations: RouteOperation[] = [];
  const methods = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of methods) {
      const operation = (pathItem as OpenAPIV3.PathItemObject)[method];
      if (operation) {
        operations.push({ path, method, operation });
      }
    }
  }

  return operations;
}
