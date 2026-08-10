# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
