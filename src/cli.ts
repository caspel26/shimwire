#!/usr/bin/env bun
import { Command } from "commander";
import { registerGenerateCommand } from "./commands/generate.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerMockCommand } from "./commands/mock.ts";
import { registerRunCommand } from "./commands/run.ts";

const program = new Command();

program
  .name("shimwire")
  .description("OpenAPI-driven mock server and HTTP test runner")
  .version("0.0.1");

registerInitCommand(program);
registerRunCommand(program);
registerMockCommand(program);
registerGenerateCommand(program);

program.parse();
