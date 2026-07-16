import { afterEach, describe, expect, test } from "bun:test";
import { closeRunningServers, runningServers } from "../../src/commands/interactive.ts";
import type { FastifyInstance } from "fastify";

function fakeApp(onClose: () => void): FastifyInstance {
  return { close: async () => onClose() } as unknown as FastifyInstance;
}

afterEach(() => {
  runningServers.length = 0;
});

describe("closeRunningServers", () => {
  test("does nothing when no servers are tracked", async () => {
    await expect(closeRunningServers()).resolves.toBeUndefined();
    expect(runningServers).toHaveLength(0);
  });

  test("closes every tracked server and clears the list", async () => {
    const closedFlags: boolean[] = [false, false];
    const makeApp = (index: number) =>
      ({
        close: async () => {
          closedFlags[index] = true;
        },
      }) as unknown as FastifyInstance;

    runningServers.push({ port: 4000, app: makeApp(0) }, { port: 4001, app: makeApp(1) });

    await closeRunningServers();

    expect(closedFlags).toEqual([true, true]);
    expect(runningServers).toHaveLength(0);
  });

  test("clears the tracked list even with a single server", async () => {
    let closed = false;
    runningServers.push({ port: 4000, app: fakeApp(() => (closed = true)) });

    await closeRunningServers();

    expect(closed).toBe(true);
    expect(runningServers).toHaveLength(0);
  });
});
