import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
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
});

describe("loadEnvironment", () => {
  test("parses a valid environment", async () => {
    const env = await loadEnvironment(join(FIXTURES, "dev.env.toml"));
    expect(env.base_url).toBe("http://localhost:9999");
  });
});
