#!/usr/bin/env bun
import { Command } from "commander";
import { registerGenerateCommand } from "./commands/generate.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerInteractiveCommand } from "./commands/interactive.ts";
import { registerMockCommand } from "./commands/mock.ts";
import { registerRunCommand } from "./commands/run.ts";
import { registerWorkflowCommand } from "./commands/workflow.ts";

const program = new Command();

program
  .name("shimwire")
  .description("OpenAPI-driven mock server and HTTP test runner")
  .version("0.2.0");

registerInitCommand(program);
registerRunCommand(program);
registerMockCommand(program);
registerGenerateCommand(program);
registerWorkflowCommand(program);
registerInteractiveCommand(program);

program.parse();
