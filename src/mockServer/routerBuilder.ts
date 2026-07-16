import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { OpenAPIV3 } from "openapi-types";
import { listOperations } from "../core/openapi/loader.ts";
import { generateFakeValue } from "../core/openapi/schemaFaker.ts";
import { findOverride, type OverrideEntry } from "./overrides.ts";

function toFastifyPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ":$1");
}

function pickResponse(
  operation: OpenAPIV3.OperationObject
): { status: number; schema: OpenAPIV3.SchemaObject | undefined } | undefined {
  const responses = operation.responses ?? {};
  const successCode = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  if (!successCode) return undefined;

  const response = responses[successCode] as OpenAPIV3.ResponseObject;
  const schema = response.content?.["application/json"]?.schema as
    OpenAPIV3.SchemaObject | undefined;
  return { status: Number(successCode), schema };
}

export interface BuildMockServerOptions {
  /** Send permissive CORS headers so a browser frontend on a different
   *  origin/port can call the mock server directly. On by default since
   *  that's the mock server's primary use case. */
  cors?: boolean;
}

export function buildMockServer(
  spec: OpenAPIV3.Document,
  overrides: OverrideEntry[] = [],
  options: BuildMockServerOptions = {}
): FastifyInstance {
  const app = Fastify({ logger: false });

  if (options.cors ?? true) {
    void app.register(cors, { origin: true });
  }

  for (const { path, method, operation } of listOperations(spec)) {
    const fastifyPath = toFastifyPath(path);
    const picked = pickResponse(operation);

    app.route({
      method: method.toUpperCase() as OpenAPIV3.HttpMethods,
      url: fastifyPath,
      handler: async (request, reply) => {
        const params = request.params as Record<string, string>;
        const override = findOverride(overrides, method, path, params);

        if (override?.latency_ms) {
          await new Promise((resolve) => setTimeout(resolve, override.latency_ms));
        }

        const status = override?.status ?? picked?.status;
        if (status === undefined) {
          reply.status(204);
          return null;
        }

        reply.status(status);
        if (override?.body !== undefined) return override.body;
        return picked?.schema ? generateFakeValue(picked.schema) : {};
      },
    });
  }

  return app;
}
