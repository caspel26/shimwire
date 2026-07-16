import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";

const SCAFFOLD_DIRS = ["collections", "env", "mock"];

const DEV_ENV_TOML = `base_url = "http://localhost:8000"\n`;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold a .shimwire/ project in the current directory")
    .action(async () => {
      const root = join(process.cwd(), ".shimwire");

      if (existsSync(root)) {
        console.error(pc.red(`.shimwire/ already exists at ${root}`));
        process.exitCode = 1;
        return;
      }

      for (const dir of SCAFFOLD_DIRS) {
        await mkdir(join(root, dir), { recursive: true });
      }
      await writeFile(join(root, "env", "dev.toml"), DEV_ENV_TOML);

      console.log(pc.green(`Created .shimwire/ in ${process.cwd()}`));
      for (const dir of SCAFFOLD_DIRS) {
        console.log(pc.dim(`  .shimwire/${dir}/`));
      }
    });
}
