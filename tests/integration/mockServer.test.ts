import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { loadOpenApiSpec } from "../../src/core/openapi/loader.ts";
import {
  buildMockServer,
  type BuildMockServerOptions,
} from "../../src/mockServer/routerBuilder.ts";
import type { OverrideEntry } from "../../src/mockServer/overrides.ts";

const SPEC_PATH = join(import.meta.dir, "..", "fixtures", "petstore.openapi.yaml");

async function buildApp(
  overrides: OverrideEntry[] = [],
  options?: BuildMockServerOptions
): Promise<FastifyInstance> {
  const spec = await loadOpenApiSpec(SPEC_PATH);
  return buildMockServer(spec, overrides, options);
}

describe("mock server", () => {
  test("GET /pets returns a schema-valid array of pets", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/pets" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    for (const pet of body) {
      expect(["available", "pending", "sold"]).toContain(pet.status);
      expect(typeof pet.id).toBe("string");
      expect(typeof pet.name).toBe("string");
    }
  });

  test("POST /pets returns 201 with a fake Pet", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/pets" });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe("string");
  });

  test("GET /pets/:id resolves the path param route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/pets/abc-123" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.name).toBe("string");
  });

  test("overrides force a specific status code for a matching path/method", async () => {
    const app = await buildApp([{ path: "/pets/{id}", method: "GET", status: 404 }]);
    const res = await app.inject({ method: "GET", url: "/pets/abc-123" });

    expect(res.statusCode).toBe(404);
  });

  test("overrides with a when clause only match the specified param value", async () => {
    const app = await buildApp([
      { path: "/pets/{id}", method: "GET", status: 404, when: "id == '999'" },
    ]);

    const notFound = await app.inject({ method: "GET", url: "/pets/999" });
    expect(notFound.statusCode).toBe(404);

    const normal = await app.inject({ method: "GET", url: "/pets/abc-123" });
    expect(normal.statusCode).toBe(200);
  });

  test("overriding body alone keeps the schema-driven status code", async () => {
    const app = await buildApp([
      {
        path: "/pets/{id}",
        method: "GET",
        body: { id: "fixed-id", name: "Fixed", status: "sold" },
      },
    ]);
    const res = await app.inject({ method: "GET", url: "/pets/abc-123" });

    expect(res.statusCode).toBe(200);
    expect(res.json() as unknown).toEqual({ id: "fixed-id", name: "Fixed", status: "sold" });
  });

  test("overriding status alone still returns a schema-valid fake body", async () => {
    const app = await buildApp([{ path: "/pets/{id}", method: "GET", status: 201 }]);
    const res = await app.inject({ method: "GET", url: "/pets/abc-123" });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe("string");
  });

  test("latency-only override doesn't force a status or empty body", async () => {
    const app = await buildApp([{ path: "/pets/{id}", method: "GET", latency_ms: 5 }]);
    const res = await app.inject({ method: "GET", url: "/pets/abc-123" });

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().name).toBe("string");
  });

  test("sends permissive CORS headers by default", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/pets",
      headers: { origin: "http://localhost:3000" },
    });

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  test("omits CORS headers when cors: false", async () => {
    const app = await buildApp([], { cors: false });
    const res = await app.inject({
      method: "GET",
      url: "/pets",
      headers: { origin: "http://localhost:3000" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
