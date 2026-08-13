import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Command } from "commander";
import { createMcpServer } from "../mcp/server.ts";
import { closeAllMockInstances } from "../mcp/mockRegistry.ts";

export async function runMcp(): Promise<void> {
  // Belt-and-suspenders on top of the tools already avoiding log.* directly
  // (see mcp/server.ts): redirect console.log/console.info to stderr for the
  // life of this process. On stdio transport, stdout IS the JSON-RPC
  // channel — any stray console.log anywhere in the dependency tree would
  // corrupt every message after it. The SDK's own transport writes straight
  // to the process.stdout stream, not through console.log, so this doesn't
  // touch protocol traffic.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);

  // A mock started via start_mock outlives the tool call that started it —
  // nothing else stops it if the client just disconnects, so tie its
  // lifetime to this process's instead.
  const shutdown = (): void => {
    void closeAllMockInstances().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr, not stdout — same reasoning as the redirect above. Purely a
  // human-visible confirmation for someone running this directly in a
  // terminal; an MCP client talking over stdio doesn't need it. Written
  // directly rather than via console.error, which Bun auto-colors red —
  // misleading for a line that isn't reporting a problem.
  process.stderr.write("shimwire mcp: ready, listening on stdio\n");
}

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description(
      "Start an MCP server (stdio) exposing shimwire's spec/collection/workflow tools to an AI client"
    )
    .action(runMcp);
}
