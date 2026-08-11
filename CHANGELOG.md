# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-08-11

### Fixed

- `assets/logo-dark.png`: the "shim" recolor region was clipped at the wrong
  x-boundary and bled onto the left stroke of "w" in "wire".

## [0.4.0] - 2026-08-11

### Added

- **`shimwire mcp`** — an [MCP](https://modelcontextprotocol.io) server (stdio
  transport) exposing shimwire to AI clients (Claude Desktop, Claude Code, or
  anything else that speaks MCP), with 7 tools: `load_spec`, `init_project`,
  `generate_collection`, `create_workflow`, `list_collections`,
  `list_workflows`, `run_collection`. An agent can inspect a spec, scaffold a
  project, and verify the result actually works, without knowing shimwire's
  flags — see the README's `shimwire mcp` section for the client config and
  a real recorded session.

### Changed

- `generate.ts`, `workflow.ts`, and `init.ts` are each split into a
  `performX()` core function (does the work, no console output, returns
  structured data) and a thin CLI wrapper that logs based on the result —
  the same shape `run.ts`/`executeCollection` already had. Needed so the MCP
  tools could reuse the exact same logic as the CLI commands without any
  risk of a stray `console.log` corrupting the MCP stdio JSON-RPC stream.
- Fixed a real concurrency bug caught while testing the MCP server: JSON-RPC
  over stdio lets a client pipeline tool calls without awaiting a response
  first, so per-call `cwd` handling via `process.chdir` could race between
  two in-flight calls. Fixed with a serializing queue; a client still needs
  to await a call before issuing one that depends on its result (e.g.
  `generate_collection`'s file existing before `run_collection` reads it) —
  no server-side mechanism can infer that dependency on its own.

## [0.3.0] - 2026-08-11

### Added

- **Standalone workflow execution** — `shimwire run` now works directly on a
  `.shimwire/workflows/<name>.toml` file, not just collections that `include`
  one. `run` detects which shape a file is (a collection has `[meta]`, a
  workflow doesn't) and, for a bare workflow, resolves `{{env.base_url}}`
  from `--env` the same way a hand-written collection would. Path resolution
  now checks `.shimwire/workflows/` alongside `.shimwire/collections/`, so
  `shimwire run authentication_flow.toml` just works.
- `shimwire cli` → "Run" now lists workflows alongside collections in the
  picker.

## [0.2.0] - 2026-08-11

### Added

- **Reusable workflows** — `.shimwire/workflows/<name>.toml` holds a request list
  with no `[meta]`/`base_url` of its own; any collection can pull it in via
  `include = ["name"]` in `[meta]`, merged in before the collection's own
  requests. Lets a login step (or any other setup) be defined once and reused
  across every collection that needs it, instead of copy-pasted into each one.
  `shimwire init` now scaffolds `.shimwire/workflows/` alongside the existing
  directories.
- **`shimwire workflow`** — hand-pick specific endpoints from a spec and save
  them as a workflow: `shimwire workflow --from <spec> --name <name> --endpoints
<id1,id2,...>`. Unknown ids are skipped with a warning rather than failing
  outright.
- **`shimwire cli`** gets a "Workflow" menu entry — lists every operation in a
  spec as a checkbox list (method, path, and the id it'll get) to build a
  workflow interactively without knowing ids up front.
- **`shimwire generate`** now detects a login-shaped operation (by
  operationId/path) whose response has a token-shaped field, and extracts it
  into `.shimwire/workflows/authentication_flow.toml` automatically — every
  bearer-secured request then depends on it and reads its token from the
  login step's actual response field, instead of a static `{{env.token}}`
  guess.
- Published to npm as [`shimwire`](https://www.npmjs.com/package/shimwire) —
  `npm install -g shimwire` or `bunx shimwire`. No build step; ships the raw
  TypeScript off `src/cli.ts`'s `#!/usr/bin/env bun` shebang, which npm's bin
  mechanism respects directly on both POSIX and Windows.

### Fixed

- CI had been failing on every run since mid-July regardless of actual
  pass/fail counts — Bun doesn't clear a previously-set `process.exitCode`
  when reassigned `undefined` (only an explicit falsy number sticks), so one
  test's intentional "sets exit code 1" mutation was silently surviving into
  every later test file.

## [0.1.0] - 2026-08-10

First public release. Phases 0–3 of the [implementation plan](shimwire-implementation-plan.md)
are done: `init`, `run`, `mock`, and `generate` are all implemented and tested.
Phase 4 (TUI) is deferred; Phase 5 (packaging/distribution) hasn't started —
run from source for now.

### Added

- **`shimwire init`** — scaffolds `.shimwire/{collections,env,mock}/`, a starter
  `.shimwire/config.toml`, and a `.gitignore` entry protecting `.shimwire/env/*.toml`
  secrets.
- **`shimwire mock [spec]`** — serves fake-but-schema-valid responses for every
  endpoint in an OpenAPI 3.x or Swagger 2.0 spec (older specs auto-converted).
  - Schema-aware fake data (`type`, `format`, `enum`, `min`/`max`), not random junk.
  - CORS on by default, so a browser frontend on another port just works.
  - Live request log (time, method, path, status, duration) with `--watch`/`--no-watch`.
  - Overrides (`.shimwire/mock/overrides.toml`) to force a status, inject latency,
    or pin an exact response body — independently of each other.
  - `--allow-local`/`--insecure` for fetching specs from local/self-signed dev servers.
- **`shimwire generate`** — auto-scaffolds a runnable TOML collection from a spec.
  - Heuristic `depends_on` linking between a resource's `POST` and its `/{id}`
    operations, including multi-level nested paths.
  - Auth pre-fill from `securitySchemes` (bearer/basic/apiKey), with `--security`
    to pick among alternatives.
  - Fake request bodies via the same schema faker used by `mock`.
  - Unresolvable guesses are written as review-comment headers in the generated file.
- **`shimwire run <collection>`** — scriptable HTTP test runner for git-diffable
  TOML collections (not a proprietary cloud format).
  - Variable interpolation: `env.*`, `faker.*`, `steps.<id>.*`.
  - `--only` to run a single request plus its dependencies.
  - `--fail-on-error` for CI, and `--report` for a readable HTML report
    (sensitive headers redacted).
- **`shimwire cli`** — guided interactive menu (Mock/Generate/Run/Init) for
  exploring a spec without memorizing flags; pre-fills from
  `.shimwire/config.toml`, offers to run a collection right after generating it,
  and keeps a mock server running in the background between menu picks.
- **`.shimwire/config.toml`** — per-project defaults for `generate`, `run`, and
  `mock`, overridden by any CLI flag actually passed.
- Clean, single-line CLI errors on failure (bad spec, missing config, port in
  use, ...) with exit code 1; set `SHIMWIRE_DEBUG=1` for the full stack trace.
- CI (lint, format check, test) on every push/PR to `main`.
