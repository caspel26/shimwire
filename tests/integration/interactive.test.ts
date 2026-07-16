import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

describe("shimwire cli", () => {
  test("is registered and shows up in --help", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--help"], { stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("cli");
    expect(stdout).toContain("interactive menu");
  });

  test("launches and renders the main menu prompt", async () => {
    // @inquirer/prompts needs a TTY for arrow-key selection, so we only
    // verify it starts and prints the first question without crashing —
    // driving the full menu is left to manual testing in a real terminal.
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "cli"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const chunks: string[] = [];
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    const timeout = setTimeout(() => proc.kill(), 1500);

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
        if (chunks.join("").includes("What do you want to do?")) break;
      }
    } finally {
      clearTimeout(timeout);
      proc.kill();
    }

    expect(chunks.join("")).toContain("What do you want to do?");
  });
});
