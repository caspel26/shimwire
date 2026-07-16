import { describe, expect, test } from "bun:test";
import { generateFakeValue } from "../../src/core/openapi/schemaFaker.ts";

describe("generateFakeValue", () => {
  test("respects string minLength/maxLength", () => {
    const value = generateFakeValue({ type: "string", minLength: 3, maxLength: 10 }) as string;
    expect(value.length).toBeGreaterThanOrEqual(3);
    expect(value.length).toBeLessThanOrEqual(10);
  });

  test("respects enum for strings", () => {
    const value = generateFakeValue({ type: "string", enum: ["a", "b", "c"] }) as string;
    expect(["a", "b", "c"]).toContain(value);
  });

  test("respects integer minimum/maximum", () => {
    const value = generateFakeValue({ type: "integer", minimum: 5, maximum: 8 }) as number;
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(5);
    expect(value).toBeLessThanOrEqual(8);
  });

  test("generates an object matching declared properties", () => {
    const value = generateFakeValue({
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        age: { type: "integer", minimum: 0, maximum: 99 },
      },
    }) as Record<string, unknown>;

    expect(typeof value.id).toBe("string");
    expect(typeof value.name).toBe("string");
    expect(typeof value.age).toBe("number");
  });

  test("generates an array respecting minItems/maxItems", () => {
    const value = generateFakeValue({
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string" },
    }) as unknown[];
    expect(value.length).toBe(2);
  });

  test("uuid format looks like a uuid", () => {
    const value = generateFakeValue({ type: "string", format: "uuid" }) as string;
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test("doesn't throw when maxLength is smaller than the default min", () => {
    const value = generateFakeValue({ type: "string", maxLength: 2 }) as string;
    expect(value.length).toBeLessThanOrEqual(2);
  });

  test("doesn't throw when maximum is smaller than the default min", () => {
    const value = generateFakeValue({ type: "integer", maximum: -5 }) as number;
    expect(value).toBeLessThanOrEqual(-5);
  });

  test("doesn't throw when maxItems is smaller than the default min", () => {
    const value = generateFakeValue({
      type: "array",
      maxItems: 0,
      items: { type: "string" },
    }) as unknown[];
    expect(value.length).toBe(0);
  });
});
