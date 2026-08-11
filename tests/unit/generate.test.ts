import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as toml from "smol-toml";
import type { OpenAPIV3 } from "openapi-types";
import { generateCollection } from "../../src/core/openapi/generate.ts";
import { loadOpenApiSpec } from "../../src/core/openapi/loader.ts";
import { CollectionSchema, WorkflowSchema } from "../../src/core/collection/types.ts";

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

  test("resolves each path param in a multi-level nested path to its own dependency", () => {
    const spec: OpenAPIV3.Document = {
      openapi: "3.0.3",
      info: { title: "Nested test", version: "1.0.0" },
      paths: {
        "/players": {
          post: {
            operationId: "createPlayer",
            responses: {
              "201": {
                description: "Created",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { uuid: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
        "/players/{uuid}/inventory": {
          post: {
            operationId: "addInventoryItem",
            responses: {
              "201": {
                description: "Created",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { id: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
        "/players/{uuid}/inventory/{id}": {
          delete: {
            operationId: "removeInventoryItem",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const { requests } = generateCollection(spec);
    const addItem = requests.find((r) => r.id === "add_inventory_item");
    const removeItem = requests.find((r) => r.id === "remove_inventory_item");

    // the nested POST's own path param must resolve too, not just non-POST methods
    expect(addItem?.path).toBe("/players/{{steps.create_player.response.uuid}}/inventory");
    expect(addItem?.depends_on).toEqual(["create_player"]);

    // each param in a multi-param path must link to its own resource's create,
    // not both collapse onto the single nearest one
    expect(removeItem?.path).toBe(
      "/players/{{steps.create_player.response.uuid}}/inventory/{{steps.add_inventory_item.response.id}}"
    );
    expect(removeItem?.depends_on).toEqual(
      expect.arrayContaining(["create_player", "add_inventory_item"])
    );
    expect(removeItem?.depends_on).toHaveLength(2);
  });

  test("prefers an auto-configurable auth scheme among OR alternatives", () => {
    const spec: OpenAPIV3.Document = {
      openapi: "3.0.3",
      info: { title: "Multi-auth test", version: "1.0.0" },
      paths: {
        "/widgets": {
          get: {
            operationId: "listWidgets",
            security: [{ SessionAuth: [] }, { ApiKeyAuth: [] }, { JwtAuth: [] }],
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: {
        securitySchemes: {
          SessionAuth: { type: "apiKey", in: "cookie", name: "session_key" },
          ApiKeyAuth: { type: "apiKey", in: "header", name: "Authorization" },
          JwtAuth: { type: "http", scheme: "bearer" },
        },
      },
    };

    const { requests, reviewNotes } = generateCollection(spec);
    const listWidgets = requests.find((r) => r.id === "list_widgets");

    expect(listWidgets?.auth).toEqual({
      type: "apiKey",
      header: "Authorization",
      value: "{{env.api_key_auth}}",
    });
    expect(reviewNotes.some((n) => n.includes("list_widgets"))).toBe(false);
  });

  test("preferredSecurityScheme overrides the default first-match pick", () => {
    const spec: OpenAPIV3.Document = {
      openapi: "3.0.3",
      info: { title: "Multi-auth test", version: "1.0.0" },
      paths: {
        "/widgets": {
          get: {
            operationId: "listWidgets",
            // JwtAuth listed before ApiKeyAuth, so it would win by default.
            security: [{ JwtAuth: [] }, { ApiKeyAuth: [] }],
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: {
        securitySchemes: {
          JwtAuth: { type: "http", scheme: "bearer" },
          ApiKeyAuth: { type: "apiKey", in: "header", name: "Authorization" },
        },
      },
    };

    const withoutPreference = generateCollection(spec);
    expect(withoutPreference.requests[0]?.auth).toEqual({ type: "bearer", token: "{{env.token}}" });

    const withPreference = generateCollection(spec, { preferredSecurityScheme: "ApiKeyAuth" });
    expect(withPreference.requests[0]?.auth).toEqual({
      type: "apiKey",
      header: "Authorization",
      value: "{{env.api_key_auth}}",
    });
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

  test("strips nulls from nullable request bodies so the result serializes to TOML", () => {
    const spec: OpenAPIV3.Document = {
      openapi: "3.0.3",
      info: { title: "Nullable test", version: "1.0.0" },
      paths: {
        "/widgets": {
          post: {
            operationId: "createWidget",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string", nullable: true },
                      tag: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
    };

    // nullable fields only turn up null ~10% of the time; repeat to reliably
    // exercise the null-stripping path instead of relying on one lucky roll.
    for (let i = 0; i < 30; i++) {
      const { meta, requests } = generateCollection(spec);
      expect(JSON.stringify(requests)).not.toContain("null");
      expect(() => toml.stringify({ meta, request: requests })).not.toThrow();
    }
  });

  describe("login detection → reusable workflow", () => {
    const specWithLogin: OpenAPIV3.Document = {
      openapi: "3.0.3",
      info: { title: "Auth test", version: "1.0.0" },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
      paths: {
        "/auth/login": {
          post: {
            operationId: "login",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { access_token: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
        "/users/{id}": {
          get: {
            operationId: "getUser",
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    test("extracts the login operation into a workflow instead of a top-level request", () => {
      const { requests, workflow } = generateCollection(specWithLogin);

      expect(requests.map((r) => r.id)).toEqual(["get_user"]);
      expect(workflow?.name).toBe("authentication_flow");
      expect(workflow?.requests.map((r) => r.id)).toEqual(["login"]);
    });

    test("points the dependent request's bearer token at the login step's response field", () => {
      const { requests } = generateCollection(specWithLogin);
      const getUser = requests.find((r) => r.id === "get_user");

      expect(getUser?.auth).toEqual({
        type: "bearer",
        token: "{{steps.login.response.access_token}}",
      });
      expect(getUser?.depends_on).toContain("login");
    });

    test("sets meta.include to the workflow name", () => {
      const { meta } = generateCollection(specWithLogin);
      expect(meta.include).toEqual(["authentication_flow"]);
    });

    test("produced collection + workflow both validate against their schemas", () => {
      const { meta, requests, workflow } = generateCollection(specWithLogin);

      const collectionResult = CollectionSchema.safeParse({ meta, request: requests });
      expect(collectionResult.success).toBe(true);

      const workflowResult = WorkflowSchema.safeParse({ request: workflow?.requests });
      expect(workflowResult.success).toBe(true);
    });

    test("falls back to static {{env.token}} when no login-shaped operation exists (petstore fixture)", async () => {
      const spec = await loadOpenApiSpec(SPEC_PATH);
      const { requests, workflow } = generateCollection(spec);
      const createPet = requests.find((r) => r.id === "create_pet");

      expect(workflow).toBeUndefined();
      expect(createPet?.auth).toEqual({ type: "bearer", token: "{{env.token}}" });
    });
  });
});
