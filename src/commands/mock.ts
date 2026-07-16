import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadOpenApiSpec, listOperations } from "../core/openapi/loader.ts";
import { loadOverrides } from "../mockServer/overrides.ts";
import { buildMockServer } from "../mockServer/routerBuilder.ts";

interface MockOptions {
  port: string;
  overrides?: string;
  allowLocal?: boolean;
  insecure?: boolean;
}

function resolveOverridesPath(explicit: string | undefined): string | undefined {
  if (explicit) return explicit;
  const defaultPath = join(process.cwd(), ".shimwire", "mock", "overrides.toml");
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function registerMockCommand(program: Command): void {
  program
    .command("mock")
    .description("Serve a fake-but-schema-valid API from an OpenAPI spec")
    .argument("<spec>", "path to an OpenAPI 3.x spec (yaml or json)")
    .option("-p, --port <port>", "port to listen on", "4000")
    .option(
      "--overrides <path>",
      "path to an overrides.toml (defaults to .shimwire/mock/overrides.toml if present)"
    )
    .option(
      "--allow-local",
      "allow fetching <spec> from localhost/private-network URLs (disables swagger-parser's SSRF guard)",
      false
    )
    .option(
      "-k, --insecure",
      "skip TLS certificate verification while fetching <spec> (self-signed/local dev certs)",
      false
    )
    .action(async (specPath: string, options: MockOptions) => {
      const spec = await loadOpenApiSpec(specPath, {
        allowLocal: options.allowLocal,
        insecure: options.insecure,
      });
      const overridesPath = resolveOverridesPath(options.overrides);
      const overrides = overridesPath ? await loadOverrides(overridesPath) : [];

      const app = buildMockServer(spec, overrides);
      const port = Number(options.port);
      await app.listen({ port });

      console.log(pc.green(`Mock server running on http://localhost:${port}`));
      for (const { method, path, operation } of listOperations(spec)) {
        const successCode =
          Object.keys(operation.responses ?? {}).find((code) => /^2\d\d$/.test(code)) ?? "204";
        console.log(pc.dim(`  ${method.toUpperCase().padEnd(6)} ${path}  → ${successCode}`));
      }
    });
}
