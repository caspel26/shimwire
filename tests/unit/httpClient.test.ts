import { afterEach, describe, expect, test } from "bun:test";
import { executeStep } from "../../src/core/executor/httpClient.ts";
import type { RequestStep } from "../../src/core/collection/types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function step(overrides: Partial<RequestStep> = {}): RequestStep {
  return { id: "x", method: "GET", path: "/x", ...overrides };
}

describe("executeStep", () => {
  test("passes tls.rejectUnauthorized: false to fetch when insecure is set", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await executeStep(step(), "https://localhost:9999", { env: {}, steps: {} }, { insecure: true });

    expect((capturedInit as unknown as { tls?: { rejectUnauthorized: boolean } })?.tls).toEqual({
      rejectUnauthorized: false,
    });
  });

  test("does not set tls when insecure is not passed", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await executeStep(step(), "https://localhost:9999", { env: {}, steps: {} });

    expect((capturedInit as unknown as { tls?: unknown })?.tls).toBeUndefined();
  });

  test("resolves {{env.x}} placeholders in apiKey auth before sending", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await executeStep(
      step({ auth: { type: "apiKey", header: "Authorization", value: "{{env.api_key}}" } }),
      "https://localhost:9999",
      { env: { api_key: "secret-123" }, steps: {} }
    );

    const headers = capturedInit?.headers as Headers;
    expect(headers.get("Authorization")).toBe("secret-123");
  });

  test("resolves {{env.x}} placeholders in bearer auth before sending", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await executeStep(
      step({ auth: { type: "bearer", token: "{{env.token}}" } }),
      "https://localhost:9999",
      { env: { token: "jwt-abc" }, steps: {} }
    );

    const headers = capturedInit?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt-abc");
  });

  test("resolves {{env.x}} placeholders in basic auth before sending", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await executeStep(
      step({ auth: { type: "basic", username: "{{env.user}}", password: "{{env.pass}}" } }),
      "https://localhost:9999",
      { env: { user: "alice", pass: "hunter2" }, steps: {} }
    );

    const headers = capturedInit?.headers as Headers;
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("alice:hunter2").toString("base64")}`
    );
  });
});
