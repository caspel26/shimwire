# shimwire

A CLI tool with two modes sharing one engine:

- **Mock mode**: generates a fake-but-schema-valid API server from an OpenAPI spec
- **Client mode**: a scriptable, git-friendly HTTP test runner (collections as version-controlled TOML files, not a proprietary cloud format)

Full design and phased rollout: [shimwire-implementation-plan.md](shimwire-implementation-plan.md). Read it before making architectural decisions — it defines the stack, project structure, data formats, and phase exit criteria.

## Status

Phases 0–3 done. `shimwire init`, `run` (Phase 1), `mock` (Phase 2), and `generate` (Phase 3 — auto-scaffolds a collection from an OpenAPI spec, with heuristic `depends_on` linking between a resource's POST and its `/{id}` operations, auth pre-fill from `securitySchemes` (bearer/basic/apiKey), and fake request bodies via the Phase 2 schema faker; unresolvable guesses are written as review-comment headers in the generated TOML) are all implemented and tested. Phase 4 (TUI) is explicitly deferred — don't build it unprompted. Phase 5 (polish/distribution) is partial: released as `v0.1.0` and published on npm (`npm install -g shimwire` / `bunx shimwire`, no build step — ships raw TS off the `#!/usr/bin/env bun` shebang in `src/cli.ts`, so `bin` must stay executable, i.e. `chmod +x`, and `files` in `package.json` must keep scoping the tarball to `src/`); standalone binaries and Homebrew aren't started. Check what's actually in a directory before assuming the plan's full structure is populated.

Repo is public. `main` requires the `test` CI check to pass before merging a PR (direct pushes from the maintainer still bypass this by design — see branch protection settings, not tracked in this repo).

## Stack

- TypeScript on **Bun** (native TS execution, `bun test`, `bun build --compile` for single-binary distribution)
- `commander` for CLI parsing, `fastify` for the mock server, `@apidevtools/swagger-parser` for OpenAPI, `@faker-js/faker` for fake data, `smol-toml` for collection/env files, `picocolors` for output
- No Node-only tooling assumptions — everything should run via `bun`, not `node`/`npm`, unless a dependency truly requires it. The one deliberate exception: `.github/workflows/publish.yml`'s actual `npm publish` step uses the real npm CLI via `actions/setup-node`, not `bun publish` — `bun publish` didn't pick up the `NODE_AUTH_TOKEN`-style auth in CI (failed with "missing authentication" despite a correctly-set secret), so don't "fix" that back to `bun publish` without solving the auth problem first.

## Gotchas

- **`process.exitCode = undefined` does not clear a previously-set exit code in Bun** (confirmed with a two-line repro; Node does clear it). Only assigning an explicit falsy number does. This bit `tests/unit/cliError.test.ts`'s `afterEach` — it reset to a captured `originalExitCode` that was `undefined`, so the "sets exit code 1" test's mutation silently survived into every later test file and `bun test` exited 1 for the whole suite regardless of pass/fail counts, for every CI run between 2026-07-16 and 2026-08-10. If a test needs to touch `process.exitCode`, always restore it with `?? 0`, never a possibly-`undefined` captured value.

## Working conventions

- The parser, schema-aware faker, and variable resolver are shared core modules imported by both `mock` and `run` commands — don't fork logic between the two entry points.
- Collections and environments are TOML, git-diffable, human-editable. Keep new config formats consistent with that (no binary/proprietary formats).
- Variable interpolation in v1 supports exactly three prefixes: `env.`, `faker.`, `steps.`. No conditionals or loops — deliberate scope limit, don't add them without checking with the user first.
- Follow the phase order in the implementation plan (Phase 0 → 1 → 2 → 3 → 5; Phase 4 TUI is explicitly deferred/optional). Don't build mock-server (Phase 2) functionality before the HTTP client/runner (Phase 1) is working, since Phase 1 is meant to ship independently first.
