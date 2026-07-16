import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadOpenApiSpec } from "../../src/core/openapi/loader.ts";
import { generateCollection } from "../../src/core/openapi/generate.ts";
import { buildMockServer } from "../../src/mockServer/routerBuilder.ts";

const SPEC_PATH = join(import.meta.dir, "..", "fixtures", "petstore.swagger2.json");

describe("Swagger 2.0 support", () => {
  test("loadOpenApiSpec converts a Swagger 2.0 doc to OpenAPI 3.x shape", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);

    expect(spec.openapi).toMatch(/^3\./);
    // response schema should have moved from `schema` directly to content.application/json.schema
    const getPet = spec.paths?.["/pets/{id}"]?.get;
    expect(getPet?.responses?.["200"]).toHaveProperty("content.application/json.schema");
    // securityDefinitions should have become components.securitySchemes
    expect(spec.components?.securitySchemes?.ApiKeyAuth).toBeDefined();
  });

  test("mock server serves schema-valid fake data from a converted Swagger 2.0 spec", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const app = buildMockServer(spec);

    const list = await app.inject({ method: "GET", url: "/pets" });
    expect(list.statusCode).toBe(200);
    const pets = list.json();
    expect(Array.isArray(pets)).toBe(true);
    for (const pet of pets) {
      expect(typeof pet.id).toBe("string");
      expect(typeof pet.name).toBe("string");
    }

    const created = await app.inject({ method: "POST", url: "/pets" });
    expect(created.statusCode).toBe(201);
  });

  test("generate produces a fake request body from a Swagger 2.0 body parameter", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { requests } = generateCollection(spec);
    const createPet = requests.find((r) => r.id === "create_pet");

    expect(createPet?.body).toBeDefined();
    const body = createPet?.body as { name: string };
    expect(typeof body.name).toBe("string");
  });

  test("generate pre-fills auth from securityDefinitions", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { requests } = generateCollection(spec);
    const createPet = requests.find((r) => r.id === "create_pet");

    expect(createPet?.auth).toEqual({
      type: "apiKey",
      header: "X-Api-Key",
      value: "{{env.api_key_auth}}",
    });
  });
});
