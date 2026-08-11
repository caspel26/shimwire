import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { withErrorHandling } from "../core/cliError.ts";
import { log } from "../core/logger.ts";

const SCAFFOLD_DIRS = ["collections", "env", "mock", "workflows"];

const DEV_ENV_TOML = `base_url = "http://localhost:8000"\n`;

const CONFIG_TOML = `# Uncomment and fill in to give shimwire generate/run/mock defaults for
# this project. CLI flags always override these values — see the README's
# Configuration section.

# [generate]
# from = "https://localhost:8080/openapi.json"
# out = ".shimwire/collections/api.toml"
# security = "APIKeyAuthSchemeName"   # when a spec offers multiple auth alternatives
# allow_local = true                  # allow fetching \`from\` from localhost/private-network URLs
# insecure = true                     # skip TLS verification (self-signed local certs)

# [run]
# report = ".shimwire/reports/latest.html"

# [mock]
# spec = "https://localhost:8080/openapi.json"
# port = 4000
# allow_local = true
# insecure = true
# cors = true
`;

const GITIGNORE_BLOCK = `
# shimwire — keep local secrets out of git
.shimwire/env/*.toml
!.shimwire/env/*.example.toml
`;

async function ensureGitignoreEntry(
  cwd: string
): Promise<"created" | "appended" | "already-present"> {
  const path = join(cwd, ".gitignore");

  if (!existsSync(path)) {
    await writeFile(path, GITIGNORE_BLOCK.trimStart() + "\n");
    return "created";
  }

  const existing = await readFile(path, "utf8");
  if (existing.includes(".shimwire/env")) {
    return "already-present";
  }

  await writeFile(path, existing.replace(/\n*$/, "\n") + GITIGNORE_BLOCK);
  return "appended";
}

export async function runInit(): Promise<void> {
  const root = join(process.cwd(), ".shimwire");

  if (existsSync(root)) {
    throw new Error(`.shimwire/ already exists at ${root}`);
  }

  for (const dir of SCAFFOLD_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, "env", "dev.toml"), DEV_ENV_TOML);
  await writeFile(join(root, "config.toml"), CONFIG_TOML);

  log.success(`Created .shimwire/ in ${process.cwd()}`);
  for (const dir of SCAFFOLD_DIRS) {
    log.dim(`  .shimwire/${dir}/`);
  }
  log.dim(`  .shimwire/config.toml (commented-out defaults for generate/run/mock)`);

  const gitignoreResult = await ensureGitignoreEntry(process.cwd());
  if (gitignoreResult === "created") {
    log.dim(`  .gitignore (created — keeps .shimwire/env/*.toml out of git)`);
  } else if (gitignoreResult === "appended") {
    log.dim(`  .gitignore (updated — added a rule to keep .shimwire/env/*.toml out of git)`);
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold a .shimwire/ project in the current directory")
    .action(withErrorHandling(runInit));
}
