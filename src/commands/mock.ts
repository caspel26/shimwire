import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { withErrorHandling } from "../core/cliError.ts";
import { loadConfig } from "../core/config/config.ts";
import { loadOpenApiSpec, listOperations } from "../core/openapi/loader.ts";
import { log } from "../core/logger.ts";
import { loadOverrides } from "../mockServer/overrides.ts";
import { buildMockServer } from "../mockServer/routerBuilder.ts";

interface MockOptions {
  port?: string;
  overrides?: string;
  allowLocal?: boolean;
  insecure?: boolean;
  cors?: boolean;
}

function resolveOverridesPath(explicit: string | undefined): string | undefined {
  if (explicit) return explicit;
  const defaultPath = join(process.cwd(), ".shimwire", "mock", "overrides.toml");
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function registerMockCommand(program: Command): void {
  program
    .command("mock")
    .description(
      "Serve a fake-but-schema-valid API from an OpenAPI spec (flags override .shimwire/config.toml [mock] defaults)"
    )
    .argument(
      "[spec]",
      "path to an OpenAPI 3.x or Swagger 2.0 spec (yaml or json, or a URL); falls back to [mock].spec in config"
    )
    .option("-p, --port <port>", "port to listen on (default: 4000)")
    .option(
      "--overrides <path>",
      "path to an overrides.toml (defaults to .shimwire/mock/overrides.toml if present)"
    )
    .option(
      "-l, --allow-local",
      "allow fetching <spec> from localhost/private-network URLs (disables swagger-parser's SSRF guard)"
    )
    .option(
      "-k, --insecure",
      "skip TLS certificate verification while fetching <spec> (self-signed/local dev certs)"
    )
    .option(
      "--cors",
      "enable permissive CORS headers (default; a browser frontend on another origin/port can call the mock directly)"
    )
    .option("--no-cors", "disable permissive CORS headers")
    .action(
      withErrorHandling(async (specArg: string | undefined, options: MockOptions) => {
        const config = (await loadConfig()).mock ?? {};

        const specPath = specArg ?? config.spec;
        if (!specPath) {
          throw new Error('Missing "spec": pass <spec> or set mock.spec in .shimwire/config.toml');
        }
        const port = Number(options.port ?? config.port ?? 4000);
        const allowLocal = options.allowLocal ?? config.allow_local ?? false;
        const insecure = options.insecure ?? config.insecure ?? false;
        const cors = options.cors ?? config.cors ?? true;
        const overridesOption = options.overrides ?? config.overrides;

        log.dim(`Loading spec from ${specPath}...`);
        const spec = await loadOpenApiSpec(specPath, { allowLocal, insecure });

        const overridesPath = resolveOverridesPath(overridesOption);
        const overrides = overridesPath ? await loadOverrides(overridesPath) : [];
        if (overridesPath) {
          log.dim(`Using overrides from ${overridesPath}`);
        }

        const app = buildMockServer(spec, overrides, { cors });
        try {
          await app.listen({ port });
        } catch (err) {
          if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
            throw new Error(`Port ${port} is already in use — pass --port to use a different one.`);
          }
          throw err;
        }

        log.success(`Mock server running on http://localhost:${port}`);
        for (const { method, path, operation } of listOperations(spec)) {
          const successCode =
            Object.keys(operation.responses ?? {}).find((code) => /^2\d\d$/.test(code)) ?? "204";
          log.dim(`  ${method.toUpperCase().padEnd(6)} ${path}  → ${successCode}`);
        }
      })
    );
}
