# shimwire

A CLI tool with two modes sharing one engine:

- **Mock mode**: generates a fake-but-schema-valid API server from an OpenAPI spec
- **Client mode**: a scriptable, git-friendly HTTP test runner (collections as version-controlled TOML files, not a proprietary cloud format)

Full design and phased rollout: [shimwire-implementation-plan.md](shimwire-implementation-plan.md). Read it before making architectural decisions — it defines the stack, project structure, data formats, and phase exit criteria.

## Status

Phase 0 (project setup) in progress. `bun init`, ESLint/Prettier, CI, and `shimwire init` are done. `src/commands/`, `src/core/`, `src/mockServer/`, and `tests/` exist as directories but are largely empty — `run`, `mock`, and `generate` are not implemented yet. Check what's actually in a directory before assuming the plan's full structure is populated.

## Stack

- TypeScript on **Bun** (native TS execution, `bun test`, `bun build --compile` for single-binary distribution)
- `commander` for CLI parsing, `fastify` for the mock server, `@apidevtools/swagger-parser` for OpenAPI, `@faker-js/faker` for fake data, `smol-toml` for collection/env files, `picocolors` for output
- No Node-only tooling assumptions — everything should run via `bun`, not `node`/`npm`, unless a dependency truly requires it

## Working conventions

- The parser, schema-aware faker, and variable resolver are shared core modules imported by both `mock` and `run` commands — don't fork logic between the two entry points.
- Collections and environments are TOML, git-diffable, human-editable. Keep new config formats consistent with that (no binary/proprietary formats).
- Variable interpolation in v1 supports exactly three prefixes: `env.`, `faker.`, `steps.`. No conditionals or loops — deliberate scope limit, don't add them without checking with the user first.
- Follow the phase order in the implementation plan (Phase 0 → 1 → 2 → 3 → 5; Phase 4 TUI is explicitly deferred/optional). Don't build mock-server (Phase 2) functionality before the HTTP client/runner (Phase 1) is working, since Phase 1 is meant to ship independently first.
