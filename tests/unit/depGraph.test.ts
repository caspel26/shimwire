import { describe, expect, test } from "bun:test";
import {
  CyclicDependencyError,
  filterToTarget,
  topologicalSort,
} from "../../src/core/collection/depGraph.ts";
import type { RequestStep } from "../../src/core/collection/types.ts";

function step(id: string, depends_on?: string[]): RequestStep {
  return { id, method: "GET", path: "/x", depends_on };
}

describe("topologicalSort", () => {
  test("orders dependencies before dependents", () => {
    const steps = [step("get_user", ["create_user"]), step("create_user")];
    const ordered = topologicalSort(steps).map((s) => s.id);
    expect(ordered).toEqual(["create_user", "get_user"]);
  });

  test("throws on cyclic dependencies", () => {
    const steps = [step("a", ["b"]), step("b", ["a"])];
    expect(() => topologicalSort(steps)).toThrow(CyclicDependencyError);
  });
});

describe("filterToTarget", () => {
  test("keeps only the target and its transitive dependencies", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"]), step("unrelated")];
    const result = filterToTarget(steps, "c").map((s) => s.id);
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("throws if the target id doesn't exist", () => {
    expect(() => filterToTarget([step("a")], "missing")).toThrow();
  });
});
