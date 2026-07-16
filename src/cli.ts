#!/usr/bin/env bun
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.ts";
import { registerRunCommand } from "./commands/run.ts";

const program = new Command();

program
  .name("shimwire")
  .description("OpenAPI-driven mock server and HTTP test runner")
  .version("0.0.1");

registerInitCommand(program);
registerRunCommand(program);

program.parse();
