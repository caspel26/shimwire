import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { generateCollection } from "../../src/core/openapi/generate.ts";
import { loadOpenApiSpec } from "../../src/core/openapi/loader.ts";
import { CollectionSchema } from "../../src/core/collection/types.ts";

const SPEC_PATH = join(import.meta.dir, "..", "fixtures", "petstore.openapi.yaml");

describe("generateCollection", () => {
  test("covers every operation in the spec", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { requests } = generateCollection(spec);
    expect(requests.map((r) => r.id).sort()).toEqual(["create_pet", "get_pet", "list_pets"].sort());
  });

  test("links get_pet to create_pet and rewrites the path param", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { requests, reviewNotes } = generateCollection(spec);
    const getPet = requests.find((r) => r.id === "get_pet");

    expect(getPet?.depends_on).toEqual(["create_pet"]);
    expect(getPet?.path).toBe("/pets/{{steps.create_pet.response.id}}");
    expect(reviewNotes.some((n) => n.includes("get_pet"))).toBe(true);
  });

  test("pre-fills bearer auth from securitySchemes", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { requests } = generateCollection(spec);
    const createPet = requests.find((r) => r.id === "create_pet");

    expect(createPet?.auth).toEqual({ type: "bearer", token: "{{env.token}}" });
  });

  test("generates a fake request body matching the requestBody schema", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { requests } = generateCollection(spec);
    const createPet = requests.find((r) => r.id === "create_pet");
    const body = createPet?.body as { name: string; status: string };

    expect(typeof body.name).toBe("string");
    expect(["available", "pending", "sold"]).toContain(body.status);
  });

  test("produced collection object validates against CollectionSchema", async () => {
    const spec = await loadOpenApiSpec(SPEC_PATH);
    const { meta, requests } = generateCollection(spec);
    const result = CollectionSchema.safeParse({ meta, request: requests });
    expect(result.success).toBe(true);
  });
});
