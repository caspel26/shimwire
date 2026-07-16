import { afterEach, describe, expect, test } from "bun:test";
import { withErrorHandling } from "../../src/core/cliError.ts";

const originalExitCode = process.exitCode;
const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const originalDebugEnv = process.env.SHIMWIRE_DEBUG;

afterEach(() => {
  process.exitCode = originalExitCode;
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
  if (originalDebugEnv === undefined) delete process.env.SHIMWIRE_DEBUG;
  else process.env.SHIMWIRE_DEBUG = originalDebugEnv;
});

describe("withErrorHandling", () => {
  test("does not swallow success — the wrapped action still runs to completion", async () => {
    let ran = false;
    const wrapped = withErrorHandling(async () => {
      ran = true;
    });

    await wrapped();
    expect(ran).toBe(true);
    expect(process.exitCode).toBe(originalExitCode);
  });

  test("catches a thrown Error, prints one clean line, and sets exit code 1", async () => {
    const messages: string[] = [];
    console.error = (msg: string) => messages.push(msg);
    delete process.env.SHIMWIRE_DEBUG;

    const wrapped = withErrorHandling(async () => {
      throw new Error("spec not found");
    });

    await wrapped();

    expect(process.exitCode).toBe(1);
    expect(messages.some((m) => m.includes("Error: spec not found"))).toBe(true);
    expect(messages.some((m) => m.includes("at "))).toBe(false);
  });

  test("catches a non-Error throw and stringifies it", async () => {
    const messages: string[] = [];
    console.error = (msg: string) => messages.push(msg);

    const wrapped = withErrorHandling(async () => {
      throw "plain string failure";
    });

    await wrapped();

    expect(process.exitCode).toBe(1);
    expect(messages.some((m) => m.includes("plain string failure"))).toBe(true);
  });

  test("prints the stack trace only when SHIMWIRE_DEBUG is set", async () => {
    const messages: string[] = [];
    console.error = (msg: string) => messages.push(msg);
    console.log = (msg: string) => messages.push(msg);
    process.env.SHIMWIRE_DEBUG = "1";

    const wrapped = withErrorHandling(async () => {
      throw new Error("boom");
    });

    await wrapped();

    expect(messages.some((m) => m.includes("at "))).toBe(true);
  });
});
