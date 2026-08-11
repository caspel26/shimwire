#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerGenerateCommand } from "./commands/generate.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerInteractiveCommand } from "./commands/interactive.ts";
import { registerMcpCommand } from "./commands/mcp.ts";
import { registerMockCommand } from "./commands/mock.ts";
import { registerRunCommand } from "./commands/run.ts";
import { registerWorkflowCommand } from "./commands/workflow.ts";

const program = new Command();

program
  .name("shimwire")
  .description("OpenAPI-driven mock server and HTTP test runner")
  .version(pkg.version);

registerInitCommand(program);
registerRunCommand(program);
registerMockCommand(program);
registerGenerateCommand(program);
registerWorkflowCommand(program);
registerMcpCommand(program);
registerInteractiveCommand(program);

program.parse();
