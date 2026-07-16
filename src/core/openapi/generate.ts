import type { OpenAPIV3 } from "openapi-types";
import { listOperations, type RouteOperation } from "./loader.ts";
import { generateFakeValue } from "./schemaFaker.ts";

export interface GeneratedRequest {
  id: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  auth?: Record<string, unknown>;
  depends_on?: string[];
}

export interface GenerateResult {
  meta: { name: string; base_url: string };
  requests: GeneratedRequest[];
  reviewNotes: string[];
}

export interface GenerateOptions {
  /** When a spec offers multiple auto-configurable auth alternatives for an
   *  operation (e.g. bearer OR apiKey), prefer this scheme name if present. */
  preferredSecurityScheme?: string;
}

function toSnakeCase(input: string): string {
  return input
    .replace(/[{}]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function deriveId(op: RouteOperation, seen: Set<string>): string {
  const base = toSnakeCase(op.operation.operationId ?? `${op.method}_${op.path}`) || "request";
  let id = base;
  let counter = 2;
  while (seen.has(id)) {
    id = `${base}_${counter}`;
    counter += 1;
  }
  seen.add(id);
  return id;
}

interface PathParamOccurrence {
  param: string;
  /** The path up to (not including) this param's own `{param}` segment —
   *  the resource that this specific param addresses, e.g. for
   *  "/players/{uuid}/inventory/{id}" the "id" occurrence's resourceBase
   *  is "/players/{uuid}/inventory", not "/players". */
  resourceBase: string;
}

// A path can carry more than one param at different nesting depths (e.g.
// "/players/{uuid}/inventory/{id}"), each addressing a different resource.
// Resolving them independently — rather than picking one dependency for the
// whole path — is what lets both a top-level and a nested resource link to
// their own separate create step.
function pathParamOccurrences(path: string): PathParamOccurrence[] {
  const occurrences: PathParamOccurrence[] = [];
  const regex = /\{([^}]+)\}/g;
  for (const match of path.matchAll(regex)) {
    const param = match[1] as string;
    const prefix = path.slice(0, match.index);
    occurrences.push({ param, resourceBase: prefix.replace(/\/$/, "") });
  }
  return occurrences;
}

function buildAuthBlock(
  schemeName: string,
  scheme: OpenAPIV3.SecuritySchemeObject
): Record<string, unknown> | undefined {
  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { type: "bearer", token: "{{env.token}}" };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return { type: "basic", username: "{{env.username}}", password: "{{env.password}}" };
  }
  if (scheme.type === "apiKey" && scheme.in === "header") {
    return { type: "apiKey", header: scheme.name, value: `{{env.${toSnakeCase(schemeName)}}}` };
  }
  return undefined;
}

// Each entry in a `security` array is an alternative (OR), e.g. session-cookie
// OR bearer OR apiKey. When multiple alternatives are auto-configurable, a
// spec gives no signal for which one actually matches the caller's
// credential, so `preferredSecurityScheme` lets the caller break the tie;
// otherwise we take the first auto-configurable alternative listed.
function resolveAuth(
  spec: OpenAPIV3.Document,
  operation: OpenAPIV3.OperationObject,
  reviewNotes: string[],
  requestId: string,
  preferredSecurityScheme: string | undefined
): Record<string, unknown> | undefined {
  const requirements = operation.security ?? spec.security;
  if (!requirements || requirements.length === 0) return undefined;

  const named = requirements
    .map((requirement) => Object.keys(requirement)[0])
    .filter((name): name is string => Boolean(name))
    .map((name) => ({
      name,
      scheme: spec.components?.securitySchemes?.[name] as
        OpenAPIV3.SecuritySchemeObject | undefined,
    }))
    .filter((entry): entry is { name: string; scheme: OpenAPIV3.SecuritySchemeObject } =>
      Boolean(entry.scheme)
    );

  if (preferredSecurityScheme) {
    const preferred = named.find((entry) => entry.name === preferredSecurityScheme);
    const auth = preferred ? buildAuthBlock(preferred.name, preferred.scheme) : undefined;
    if (auth) return auth;
  }

  for (const { name, scheme } of named) {
    const auth = buildAuthBlock(name, scheme);
    if (auth) return auth;
  }

  const fallback = named[0];
  if (fallback) {
    reviewNotes.push(
      `"${requestId}" requires the "${fallback.name}" security scheme (${fallback.scheme.type}), which isn't auto-configurable — add auth manually.`
    );
  }
  return undefined;
}

// TOML has no null type, so example bodies (which get serialized to TOML)
// can't contain nulls the way JSON responses from the mock server can.
function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(stripNulls).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const stripped = stripNulls(item);
      if (stripped !== undefined) out[key] = stripped;
    }
    return out;
  }
  return value;
}

function requestBodyExample(operation: OpenAPIV3.OperationObject): unknown {
  const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
  const schema = requestBody?.content?.["application/json"]?.schema as
    OpenAPIV3.SchemaObject | undefined;
  return schema ? stripNulls(generateFakeValue(schema)) : undefined;
}

export function generateCollection(
  spec: OpenAPIV3.Document,
  options: GenerateOptions = {}
): GenerateResult {
  const operations = listOperations(spec);
  const seenIds = new Set<string>();
  const reviewNotes: string[] = [];

  const withIds = operations.map((op) => ({ op, id: deriveId(op, seenIds) }));

  const createByBasePath = new Map<string, string>();
  for (const { op, id } of withIds) {
    if (op.method === "post") {
      createByBasePath.set(op.path, id);
    }
  }

  const requests: GeneratedRequest[] = withIds.map(({ op, id }) => {
    const { path, method, operation } = op;
    let resolvedPath = path;
    const dependsOn = new Set<string>();

    for (const { param, resourceBase } of pathParamOccurrences(path)) {
      const createId = createByBasePath.get(resourceBase);
      if (createId && createId !== id) {
        dependsOn.add(createId);
        resolvedPath = resolvedPath.replace(
          `{${param}}`,
          `{{steps.${createId}.response.${param}}}`
        );
        reviewNotes.push(
          `"${id}" was guessed to depend on "${createId}" for its "${param}" path parameter, assuming the response includes a matching "${param}" field — please confirm.`
        );
      } else {
        resolvedPath = resolvedPath.replace(`{${param}}`, "REPLACE_ME");
        reviewNotes.push(
          `"${id}" has an unresolved "${param}" path parameter — replace "REPLACE_ME" in its path.`
        );
      }
    }

    const auth = resolveAuth(spec, operation, reviewNotes, id, options.preferredSecurityScheme);
    const body = requestBodyExample(operation);

    const request: GeneratedRequest = { id, method: method.toUpperCase(), path: resolvedPath };
    if (dependsOn.size > 0) request.depends_on = [...dependsOn];
    if (auth) request.auth = auth;
    if (body !== undefined) request.body = body;
    return request;
  });

  return {
    meta: { name: spec.info?.title ?? "Generated collection", base_url: "{{env.base_url}}" },
    requests,
    reviewNotes,
  };
}
