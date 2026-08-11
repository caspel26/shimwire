import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CollectionParseError,
  loadCollection,
  loadEnvironment,
} from "../../src/core/collection/parser.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const TMP = mkdtempSync(join(tmpdir(), "shimwire-parser-test-"));

describe("loadCollection", () => {
  test("parses a valid collection", async () => {
    const collection = await loadCollection(join(FIXTURES, "users.toml"));
    expect(collection.meta.name).toBe("Users API");
    expect(collection.request.map((r) => r.id)).toEqual(["create_user", "get_user"]);
  });

  test("rejects duplicate request ids", async () => {
    const path = join(TMP, "duplicate-ids.toml");
    await Bun.write(
      path,
      `[meta]
name = "X"
base_url = "http://x"

[[request]]
id = "a"
method = "GET"
path = "/a"

[[request]]
id = "a"
method = "GET"
path = "/b"
`
    );
    await expect(loadCollection(path)).rejects.toThrow(CollectionParseError);
  });

  test("rejects depends_on referencing an unknown id", async () => {
    const path = join(TMP, "bad-dep.toml");
    await Bun.write(
      path,
      `[meta]
name = "X"
base_url = "http://x"

[[request]]
id = "a"
method = "GET"
path = "/a"
depends_on = ["nope"]
`
    );
    await expect(loadCollection(path)).rejects.toThrow(CollectionParseError);
  });

  describe("meta.include (reusable workflows)", () => {
    async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
      const original = process.cwd();
      process.chdir(cwd);
      try {
        return await fn();
      } finally {
        process.chdir(original);
      }
    }

    test("merges an included workflow's requests before the collection's own", async () => {
      const project = mkdtempSync(join(tmpdir(), "shimwire-include-test-"));
      mkdirSync(join(project, ".shimwire", "workflows"), { recursive: true });
      await Bun.write(
        join(project, ".shimwire", "workflows", "auth_flow.toml"),
        `[[request]]
id = "login"
method = "POST"
path = "/auth/login"
`
      );
      const collectionPath = join(project, "users.toml");
      await Bun.write(
        collectionPath,
        `[meta]
name = "Users API"
base_url = "http://x"
include = ["auth_flow"]

[[request]]
id = "get_user"
method = "GET"
path = "/users/42"
depends_on = ["login"]
`
      );

      const collection = await withCwd(project, () => loadCollection(collectionPath));
      expect(collection.request.map((r) => r.id)).toEqual(["login", "get_user"]);
    });

    test("rejects an id collision between a workflow and the including collection", async () => {
      const project = mkdtempSync(join(tmpdir(), "shimwire-include-test-"));
      mkdirSync(join(project, ".shimwire", "workflows"), { recursive: true });
      await Bun.write(
        join(project, ".shimwire", "workflows", "auth_flow.toml"),
        `[[request]]
id = "login"
method = "POST"
path = "/auth/login"
`
      );
      const collectionPath = join(project, "users.toml");
      await Bun.write(
        collectionPath,
        `[meta]
name = "Users API"
base_url = "http://x"
include = ["auth_flow"]

[[request]]
id = "login"
method = "GET"
path = "/whoops"
`
      );

      await expect(withCwd(project, () => loadCollection(collectionPath))).rejects.toThrow(
        CollectionParseError
      );
    });

    test("errors clearly when the included workflow file doesn't exist", async () => {
      const project = mkdtempSync(join(tmpdir(), "shimwire-include-test-"));
      const collectionPath = join(project, "users.toml");
      await Bun.write(
        collectionPath,
        `[meta]
name = "Users API"
base_url = "http://x"
include = ["missing_flow"]

[[request]]
id = "get_user"
method = "GET"
path = "/users/42"
`
      );

      await expect(withCwd(project, () => loadCollection(collectionPath))).rejects.toThrow(
        /couldn't load included workflow "missing_flow"/
      );
    });
  });
});

describe("loadEnvironment", () => {
  test("parses a valid environment", async () => {
    const env = await loadEnvironment(join(FIXTURES, "dev.env.toml"));
    expect(env.base_url).toBe("http://localhost:9999");
  });
});
