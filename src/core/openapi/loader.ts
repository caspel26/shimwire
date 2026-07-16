import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import { convertObj } from "swagger2openapi";

export class OpenApiLoadError extends Error {}

function isSwagger2Document(doc: unknown): doc is Record<string, unknown> & { swagger: string } {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "swagger" in doc &&
    (doc as { swagger: unknown }).swagger === "2.0"
  );
}

// swaggo/swag (Go), Springfox (Java), and plenty of older tooling still emit
// Swagger 2.0, which shapes requests/responses/auth completely differently
// from OpenAPI 3.x (`schema` directly instead of `content.<type>.schema`,
// `securityDefinitions` instead of `components.securitySchemes`, body params
// via `parameters[].in === "body"` instead of `requestBody`). Every
// downstream piece of shimwire (mock, generate, the schema faker) only
// understands the 3.x shape, so convert once here rather than teaching each
// of them to branch on spec version.
//
// Must run on the *raw*, still-$ref-containing document — swagger2openapi
// rewrites `#/definitions/X` pointers to `#/components/schemas/X` as part of
// conversion. Feeding it an already-dereferenced document (where repeated
// $refs become shared object identity, not repeated $ref strings) makes it
// mistake that shared identity for a circular YAML anchor and throw.
async function toOpenApi3(doc: Record<string, unknown>): Promise<OpenAPIV3.Document> {
  if (!isSwagger2Document(doc)) return doc as unknown as OpenAPIV3.Document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await convertObj(doc as any, { patch: true, warnOnly: true, direct: true });
  return result as unknown as OpenAPIV3.Document;
}

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
  // .parse() reads/fetches the spec but leaves $refs as strings; conversion
  // (if needed) happens on that raw shape, then dereference resolves $refs
  // against the (possibly-converted) in-memory document.
  const parse = () => SwaggerParser.parse(path, resolveOptions);

  try {
    const raw = options.insecure ? await withInsecureFetch(parse) : await parse();
    const converted = await toOpenApi3(raw as unknown as Record<string, unknown>);
    return (await SwaggerParser.dereference(converted)) as OpenAPIV3.Document;
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
