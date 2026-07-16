import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";

export class OpenApiLoadError extends Error {}

export async function loadOpenApiSpec(path: string): Promise<OpenAPIV3.Document> {
  try {
    const api = await SwaggerParser.dereference(path);
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
