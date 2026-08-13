import type { FastifyInstance } from "fastify";
import type { MockRequestLogEntry } from "../mockServer/routerBuilder.ts";

// MCP is a single long-running process — unlike a `shimwire mock` CLI
// invocation (which owns the terminal for its whole lifetime, one server per
// process), start_mock/stop_mock let a client start several mocks across
// the life of one MCP connection, so they need to be tracked somewhere
// rather than just held in a local variable. This is that somewhere:
// in-memory only, cleared on process exit (see closeAllMockInstances, called
// from runMcp's SIGINT/SIGTERM handlers).

export interface MockInstance {
  id: string;
  port: number;
  spec: string;
  startedAt: string;
  app: FastifyInstance;
  requestLog: MockRequestLogEntry[];
}

// Bounded so a long-lived mock hit by heavy traffic can't grow this without
// limit — matches the intent of the CLI's live --watch log (recent
// activity), not a full audit trail.
const MAX_LOGGED_REQUESTS = 200;

const instances = new Map<string, MockInstance>();

export function createMockInstance(params: {
  port: number;
  spec: string;
  app: FastifyInstance;
}): MockInstance {
  const instance: MockInstance = {
    id: crypto.randomUUID(),
    port: params.port,
    spec: params.spec,
    app: params.app,
    startedAt: new Date().toISOString(),
    requestLog: [],
  };
  instances.set(instance.id, instance);
  return instance;
}

export function recordMockRequest(instance: MockInstance, entry: MockRequestLogEntry): void {
  instance.requestLog.push(entry);
  if (instance.requestLog.length > MAX_LOGGED_REQUESTS) {
    instance.requestLog.shift();
  }
}

export function getMockInstance(id: string): MockInstance | undefined {
  return instances.get(id);
}

export function listMockInstances(): MockInstance[] {
  return [...instances.values()];
}

export async function stopMockInstance(id: string): Promise<boolean> {
  const instance = instances.get(id);
  if (!instance) return false;
  await instance.app.close();
  instances.delete(id);
  return true;
}

export async function closeAllMockInstances(): Promise<void> {
  await Promise.all([...instances.values()].map((instance) => instance.app.close()));
  instances.clear();
}
