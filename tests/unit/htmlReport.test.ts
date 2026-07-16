import { describe, expect, test } from "bun:test";
import { renderHtmlReport, toReportEntry } from "../../src/core/executor/htmlReport.ts";
import type { ExecutedRequest } from "../../src/core/executor/httpClient.ts";

function executed(overrides: Partial<ExecutedRequest> = {}): ExecutedRequest {
  return {
    id: "get_user",
    method: "GET",
    path: "/users/1",
    status: 200,
    response: { id: 1 },
    durationMs: 12.3,
    ok: true,
    requestHeaders: { "Content-Type": "application/json" },
    ...overrides,
  };
}

describe("toReportEntry", () => {
  test("redacts sensitive headers", () => {
    const entry = toReportEntry(
      executed({ requestHeaders: { Authorization: "Bearer secret-token", "X-Api-Key": "abc123" } })
    );
    expect(entry.requestHeaders?.Authorization).toBe("«redacted»");
    expect(entry.requestHeaders?.["X-Api-Key"]).toBe("«redacted»");
  });

  test("leaves non-sensitive headers untouched", () => {
    const entry = toReportEntry(
      executed({ requestHeaders: { "Content-Type": "application/json" } })
    );
    expect(entry.requestHeaders?.["Content-Type"]).toBe("application/json");
  });
});

describe("renderHtmlReport", () => {
  test("renders a valid HTML document with pass/fail summary", () => {
    const html = renderHtmlReport(
      [
        toReportEntry(executed()),
        { id: "broken", method: "GET", path: "/x", ok: false, error: "boom" },
      ],
      { collection: "users.toml", env: "dev" }
    );

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("1 passed");
    expect(html).toContain("1 failed");
    expect(html).toContain("get_user");
    expect(html).toContain("boom");
  });

  test("never leaks a redacted secret's original value into the report", () => {
    const entry = toReportEntry(
      executed({ requestHeaders: { Authorization: "Bearer super-secret-123" } })
    );
    const html = renderHtmlReport([entry], { collection: "x.toml", env: "dev" });
    expect(html).not.toContain("super-secret-123");
  });

  test("escapes HTML in request/response data", () => {
    const entry = toReportEntry(executed({ response: { name: "<script>alert(1)</script>" } }));
    const html = renderHtmlReport([entry], { collection: "x.toml", env: "dev" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
