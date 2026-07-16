import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenApiLoadError, loadOpenApiSpec } from "../../src/core/openapi/loader.ts";

// Serves a minimal OpenAPI doc as JSON over HTTP from localhost — this is
// exactly what swagger-parser's SSRF guard blocks by default.
const specJson = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Local test", version: "1.0.0" },
  paths: {
    "/ping": { get: { operationId: "ping", responses: { "200": { description: "OK" } } } },
  },
});

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: () => new Response(specJson, { headers: { "content-type": "application/json" } }),
  });
});

afterAll(() => {
  server.stop(true);
});

describe("loadOpenApiSpec", () => {
  test("refuses localhost URLs by default (SSRF guard)", async () => {
    const url = `http://localhost:${server.port}/openapi.json`;
    await expect(loadOpenApiSpec(url)).rejects.toThrow(OpenApiLoadError);
  });

  test("allows localhost URLs when allowLocal is set", async () => {
    const url = `http://localhost:${server.port}/openapi.json`;
    const spec = await loadOpenApiSpec(url, { allowLocal: true });
    expect(spec.info.title).toBe("Local test");
  });

  test("insecure wraps fetch with tls.rejectUnauthorized: false and restores it afterward", async () => {
    const originalFetch = globalThis.fetch;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response(specJson, { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const mockFetch = globalThis.fetch;

    try {
      const spec = await loadOpenApiSpec("http://localhost:9999/openapi.json", {
        allowLocal: true,
        insecure: true,
      });

      expect(spec.info.title).toBe("Local test");
      expect((capturedInit as unknown as { tls?: { rejectUnauthorized: boolean } })?.tls).toEqual({
        rejectUnauthorized: false,
      });
      // fetch should be restored to what it was right before the call, not left wrapped.
      expect(globalThis.fetch).toBe(mockFetch);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
