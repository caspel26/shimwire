#!/usr/bin/env bun
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.ts";

const program = new Command();

program
  .name("shimwire")
  .description("OpenAPI-driven mock server and HTTP test runner")
  .version("0.0.1");

registerInitCommand(program);

program.parse();
