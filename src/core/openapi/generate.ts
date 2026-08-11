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
  meta: { name: string; base_url: string; include?: string[] };
  requests: GeneratedRequest[];
  reviewNotes: string[];
  /** Set when a login-shaped operation was detected and pulled out into a
   *  reusable workflow instead of being generated as a top-level request —
   *  the caller (the `generate` command) is responsible for writing this to
   *  .shimwire/workflows/<name>.toml. */
  workflow?: { name: string; requests: GeneratedRequest[] };
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

export interface OperationWithId {
  op: RouteOperation;
  id: string;
}

// The same id derivation generateCollection/buildWorkflowRequests use
// internally, exposed so callers that need to show or validate ids ahead of
// time (the interactive workflow picker, --endpoints validation) see exactly
// what a request would actually be named.
export function listOperationsWithIds(spec: OpenAPIV3.Document): OperationWithId[] {
  const seenIds = new Set<string>();
  return listOperations(spec).map((op) => ({ op, id: deriveId(op, seenIds) }));
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

interface LoginDetection {
  id: string;
  op: RouteOperation;
  tokenField: string;
}

const LOGIN_OPERATION_RE = /login|sign[_-]?in|authenticate/i;
const TOKEN_FIELD_RE = /token|jwt/i;

// Scans a 2xx JSON response schema for a field that plausibly holds an auth
// token — this is what lets a generated request reference
// {{steps.login.response.<field>}} instead of guessing a static env var.
function findTokenField(operation: OpenAPIV3.OperationObject): string | undefined {
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (!status.startsWith("2")) continue;
    const schema = (response as OpenAPIV3.ResponseObject).content?.["application/json"]?.schema as
      OpenAPIV3.SchemaObject | undefined;
    const match = Object.keys(schema?.properties ?? {}).find((name) => TOKEN_FIELD_RE.test(name));
    if (match) return match;
  }
  return undefined;
}

// Looks for a POST operation that reads as a login endpoint (by
// operationId or path) whose response has a token-shaped field. Deliberately
// conservative — anything short of a token field in the response schema
// falls back to the pre-existing static {{env.token}} behavior below,
// since a wrong guess here would silently point every request at the wrong
// place.
function detectLoginOperation(
  withIds: { op: RouteOperation; id: string }[]
): LoginDetection | undefined {
  for (const { op, id } of withIds) {
    if (op.method !== "post") continue;
    const looksLikeLogin =
      LOGIN_OPERATION_RE.test(op.operation.operationId ?? "") || LOGIN_OPERATION_RE.test(op.path);
    if (!looksLikeLogin) continue;
    const tokenField = findTokenField(op.operation);
    if (tokenField) return { id, op, tokenField };
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

// Shared by generateCollection (every operation) and buildWorkflowRequests
// (a hand-picked subset) — everything about turning one operation into one
// GeneratedRequest lives here so the two callers can't drift apart.
function buildRequest(
  op: RouteOperation,
  id: string,
  createByBasePath: Map<string, string>,
  spec: OpenAPIV3.Document,
  reviewNotes: string[],
  login: LoginDetection | undefined,
  preferredSecurityScheme: string | undefined
): GeneratedRequest {
  const { path, method, operation } = op;
  let resolvedPath = path;
  const dependsOn = new Set<string>();

  for (const { param, resourceBase } of pathParamOccurrences(path)) {
    const createId = createByBasePath.get(resourceBase);
    if (createId && createId !== id) {
      dependsOn.add(createId);
      resolvedPath = resolvedPath.replace(`{${param}}`, `{{steps.${createId}.response.${param}}}`);
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

  let auth = resolveAuth(spec, operation, reviewNotes, id, preferredSecurityScheme);
  if (login && id !== login.id && auth?.type === "bearer" && auth.token === "{{env.token}}") {
    auth = { type: "bearer", token: `{{steps.${login.id}.response.${login.tokenField}}}` };
    dependsOn.add(login.id);
    reviewNotes.push(
      `"${id}" depends on the auto-detected login step "${login.id}" (see .shimwire/workflows/authentication_flow.toml) for its bearer token instead of a static {{env.token}} — please confirm.`
    );
  }

  const body = requestBodyExample(operation);

  const request: GeneratedRequest = { id, method: method.toUpperCase(), path: resolvedPath };
  if (dependsOn.size > 0) request.depends_on = [...dependsOn];
  if (auth) request.auth = auth;
  if (body !== undefined) request.body = body;
  return request;
}

export interface BuildWorkflowResult {
  requests: GeneratedRequest[];
  reviewNotes: string[];
}

// Builds a standalone .shimwire/workflows/<name>.toml request list from a
// hand-picked subset of a spec's operations (by their generate-derived id —
// the same ids shown in the interactive picker and accepted by `--endpoints`).
// Dependency linking only considers other requests within the picked subset,
// not the whole spec — a workflow file has no [meta]/base_url of its own and
// is meant to be self-contained, so a dependency on something outside the
// selection would produce a dangling reference once included elsewhere.
export function buildWorkflowRequests(
  spec: OpenAPIV3.Document,
  selectedIds: string[],
  options: GenerateOptions = {}
): BuildWorkflowResult {
  const reviewNotes: string[] = [];
  const withIds = listOperationsWithIds(spec);

  const wanted = new Set(selectedIds);
  const targets = withIds.filter(({ id }) => wanted.has(id));

  const createByBasePath = new Map<string, string>();
  for (const { op, id } of targets) {
    if (op.method === "post") createByBasePath.set(op.path, id);
  }

  const requests = targets.map(({ op, id }) =>
    buildRequest(
      op,
      id,
      createByBasePath,
      spec,
      reviewNotes,
      undefined,
      options.preferredSecurityScheme
    )
  );

  return { requests, reviewNotes };
}

export function generateCollection(
  spec: OpenAPIV3.Document,
  options: GenerateOptions = {}
): GenerateResult {
  const reviewNotes: string[] = [];
  const withIds = listOperationsWithIds(spec);

  const createByBasePath = new Map<string, string>();
  for (const { op, id } of withIds) {
    if (op.method === "post") {
      createByBasePath.set(op.path, id);
    }
  }

  const login = detectLoginOperation(withIds);

  const requests: GeneratedRequest[] = withIds
    .filter(({ id }) => id !== login?.id)
    .map(({ op, id }) =>
      buildRequest(
        op,
        id,
        createByBasePath,
        spec,
        reviewNotes,
        login,
        options.preferredSecurityScheme
      )
    );

  let workflow: GenerateResult["workflow"];
  if (login) {
    const loginBody = requestBodyExample(login.op.operation);
    const loginRequest: GeneratedRequest = {
      id: login.id,
      method: login.op.method.toUpperCase(),
      path: login.op.path,
    };
    if (loginBody !== undefined) loginRequest.body = loginBody;
    workflow = { name: "authentication_flow", requests: [loginRequest] };
    reviewNotes.push(
      `Detected a login-shaped operation and extracted it into .shimwire/workflows/authentication_flow.toml as "${login.id}" — its request body has faked credentials, replace them (e.g. with {{env.username}}/{{env.password}}) before relying on this in CI.`
    );
  }

  return {
    meta: {
      name: spec.info?.title ?? "Generated collection",
      base_url: "{{env.base_url}}",
      ...(workflow ? { include: [workflow.name] } : {}),
    },
    requests,
    reviewNotes,
    workflow,
  };
}
