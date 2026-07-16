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

function baseResourcePath(path: string): string | undefined {
  const match = path.match(/^(.*)\/\{[^}]+\}$/);
  return match?.[1];
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string);
}

function resolveAuth(
  spec: OpenAPIV3.Document,
  operation: OpenAPIV3.OperationObject,
  reviewNotes: string[],
  requestId: string
): Record<string, unknown> | undefined {
  const requirements = operation.security ?? spec.security;
  if (!requirements || requirements.length === 0) return undefined;

  const schemeName = Object.keys(requirements[0] ?? {})[0];
  if (!schemeName) return undefined;

  const scheme = spec.components?.securitySchemes?.[schemeName] as
    OpenAPIV3.SecuritySchemeObject | undefined;
  if (!scheme) return undefined;

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { type: "bearer", token: "{{env.token}}" };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return { type: "basic", username: "{{env.username}}", password: "{{env.password}}" };
  }
  if (scheme.type === "apiKey" && scheme.in === "header") {
    return { type: "apiKey", header: scheme.name, value: `{{env.${toSnakeCase(schemeName)}}}` };
  }

  reviewNotes.push(
    `"${requestId}" requires the "${schemeName}" security scheme (${scheme.type}), which isn't auto-configurable — add auth manually.`
  );
  return undefined;
}

function requestBodyExample(operation: OpenAPIV3.OperationObject): unknown {
  const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
  const schema = requestBody?.content?.["application/json"]?.schema as
    OpenAPIV3.SchemaObject | undefined;
  return schema ? generateFakeValue(schema) : undefined;
}

export function generateCollection(spec: OpenAPIV3.Document): GenerateResult {
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
    const params = pathParamNames(path);
    let resolvedPath = path;
    let depends_on: string[] | undefined;

    if (params.length > 0 && method !== "post") {
      const base = baseResourcePath(path);
      const createId = base ? createByBasePath.get(base) : undefined;
      if (createId && createId !== id) {
        depends_on = [createId];
        for (const param of params) {
          resolvedPath = resolvedPath.replace(
            `{${param}}`,
            `{{steps.${createId}.response.${param}}}`
          );
        }
        reviewNotes.push(
          `"${id}" was guessed to depend on "${createId}" and assumes the response includes a matching "${params[0]}" field — please confirm.`
        );
      } else {
        for (const param of params) {
          resolvedPath = resolvedPath.replace(`{${param}}`, "REPLACE_ME");
        }
        reviewNotes.push(
          `"${id}" has an unresolved path parameter — replace "REPLACE_ME" in its path.`
        );
      }
    }

    const auth = resolveAuth(spec, operation, reviewNotes, id);
    const body = requestBodyExample(operation);

    const request: GeneratedRequest = { id, method: method.toUpperCase(), path: resolvedPath };
    if (depends_on) request.depends_on = depends_on;
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
