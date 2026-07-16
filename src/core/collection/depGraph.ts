import type { RequestStep } from "./types.ts";

export class CyclicDependencyError extends Error {}

export function topologicalSort(steps: RequestStep[]): RequestStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: RequestStep[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new CyclicDependencyError(`Cyclic dependency detected at request "${id}"`);
    }
    visiting.add(id);

    const step = byId.get(id);
    if (step) {
      for (const dep of step.depends_on ?? []) {
        visit(dep);
      }
    }

    visiting.delete(id);
    visited.add(id);
    if (step) ordered.push(step);
  }

  for (const step of steps) {
    visit(step.id);
  }

  return ordered;
}

export function filterToTarget(steps: RequestStep[], targetId: string): RequestStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  if (!byId.has(targetId)) {
    throw new Error(`No request with id "${targetId}" in this collection`);
  }

  const needed = new Set<string>();
  function collect(id: string): void {
    if (needed.has(id)) return;
    needed.add(id);
    const step = byId.get(id);
    for (const dep of step?.depends_on ?? []) {
      collect(dep);
    }
  }
  collect(targetId);

  return steps.filter((step) => needed.has(step.id));
}
