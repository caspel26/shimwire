import { describe, expect, test } from "bun:test";
import { formatMockRequestLog } from "../../src/mockServer/requestLog.ts";

describe("formatMockRequestLog", () => {
  test("includes method, path, status, and duration", () => {
    const line = formatMockRequestLog({
      method: "GET",
      path: "/pets",
      status: 200,
      durationMs: 12.4,
    });
    expect(line).toContain("GET");
    expect(line).toContain("/pets");
    expect(line).toContain("200");
    expect(line).toContain("12ms");
  });

  test("rounds fractional durations", () => {
    const line = formatMockRequestLog({ method: "GET", path: "/x", status: 200, durationMs: 0.4 });
    expect(line).toContain("0ms");
  });
});
