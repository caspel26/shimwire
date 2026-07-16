import { describe, expect, test } from "bun:test";
import {
  resolveString,
  resolveValue,
  VariableResolutionError,
} from "../../src/core/variables/resolver.ts";

describe("resolveString", () => {
  test("resolves env. variables", () => {
    const result = resolveString("{{env.base_url}}/users", {
      env: { base_url: "http://x" },
      steps: {},
    });
    expect(result).toBe("http://x/users");
  });

  test("resolves steps. paths into response bodies", () => {
    const result = resolveString("/users/{{steps.create_user.response.id}}", {
      env: {},
      steps: { create_user: { status: 201, response: { id: 42 } } },
    });
    expect(result).toBe("/users/42");
  });

  test("throws on unknown env key", () => {
    expect(() => resolveString("{{env.missing}}", { env: {}, steps: {} })).toThrow(
      VariableResolutionError
    );
  });

  test("throws on unsupported prefix", () => {
    expect(() => resolveString("{{foo.bar}}", { env: {}, steps: {} })).toThrow(
      VariableResolutionError
    );
  });
});

describe("resolveValue", () => {
  test("recursively resolves objects and arrays", () => {
    const result = resolveValue(
      { name: "{{env.name}}", tags: ["{{env.tag}}", "static"] },
      { env: { name: "Alice", tag: "vip" }, steps: {} }
    );
    expect(result).toEqual({ name: "Alice", tags: ["vip", "static"] });
  });

  test("preserves non-string types when the whole value is one placeholder", () => {
    const result = resolveValue("{{steps.a.status}}", {
      env: {},
      steps: { a: { status: 201, response: null } },
    });
    expect(result).toBe(201);
  });
});
