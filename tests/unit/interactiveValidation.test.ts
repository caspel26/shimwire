import { describe, expect, test } from "bun:test";
import { mcpConfigSnippet, notEmpty, validPort } from "../../src/commands/interactive.ts";

describe("notEmpty", () => {
  test("accepts non-blank input", () => {
    expect(notEmpty("Spec path")("foo.yaml")).toBe(true);
  });

  test("rejects blank/whitespace-only input with a labeled message", () => {
    expect(notEmpty("Spec path")("")).toBe("Spec path can't be empty.");
    expect(notEmpty("Spec path")("   ")).toBe("Spec path can't be empty.");
  });
});

describe("validPort", () => {
  test("accepts valid ports", () => {
    expect(validPort("4000")).toBe(true);
    expect(validPort("1")).toBe(true);
    expect(validPort("65535")).toBe(true);
  });

  test("rejects non-numeric, zero, negative, or out-of-range values", () => {
    expect(validPort("abc")).not.toBe(true);
    expect(validPort("0")).not.toBe(true);
    expect(validPort("-1")).not.toBe(true);
    expect(validPort("65536")).not.toBe(true);
    expect(validPort("80.5")).not.toBe(true);
  });
});

describe("mcpConfigSnippet", () => {
  test("produces a valid mcpServers config invoking `bunx shimwire mcp`", () => {
    const parsed = JSON.parse(mcpConfigSnippet());
    expect(parsed).toEqual({
      mcpServers: { shimwire: { command: "bunx", args: ["shimwire", "mcp"] } },
    });
  });
});
