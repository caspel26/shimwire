# shimwire

[![CI](https://github.com/caspel26/shimwire/actions/workflows/ci.yml/badge.svg)](https://github.com/caspel26/shimwire/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**One tool for both sides of an API you don't fully control yet: mock the parts that aren't built, and test the parts that are.**

`shimwire` reads an OpenAPI 3.x or Swagger 2.0 spec (older specs are converted automatically) and gives you two things from it, powered by one shared engine so they never drift apart:

- **Mock mode** — a fake-but-schema-valid API server, so frontend work isn't blocked waiting on a backend.
- **Client mode** — a scriptable, git-friendly HTTP test runner. Collections are version-controlled TOML files you can diff and review in a PR, not JSON blobs locked in a proprietary cloud tool.

> **Status:** functional end-to-end (Phases 0–3 of the [implementation plan](shimwire-implementation-plan.md) are done). Not yet published as an installable package — run it from source for now. Issues and design feedback are welcome.

---

## Table of contents

- [Why](#why)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Testing a frontend against the mock server](#testing-a-frontend-against-the-mock-server)
- [Collection format](#collection-format)
- [Roadmap](#roadmap)
- [Stack](#stack)
- [Contributing](#contributing)
- [License](#license)

## Why

Postman/Insomnia-style tools lock collections into proprietary formats that don't diff cleanly in git and don't run well in CI. Meanwhile, mocking a backend usually means hand-rolling fixtures that quietly drift from the real API contract. If you already have an OpenAPI (or Swagger 2.0) spec, both problems have the same fix: derive the mock _and_ the test collection from that one source of truth.

- **Git-native** — collections and environments are plain TOML files, reviewable in a normal PR diff.
- **CI-friendly** — `shimwire run` exits non-zero on failure; `--report` produces a readable HTML artifact for humans.
- **Spec-driven** — mocks and generated collections both come from your OpenAPI/Swagger spec, so they can't disagree with each other.
- **Frontend-ready** — the mock server sends permissive CORS by default, so a browser app on another port can call it with no extra setup.

## Installation

Not published to npm yet — run it from source:

```bash
git clone https://github.com/caspel26/shimwire
cd shimwire
bun install
bun run src/cli.ts <command>
```

(A `bun install -g shimwire` / compiled-binary install path is planned for Phase 5 — see the [Roadmap](#roadmap).)

> The examples below use a bare `shimwire` for readability. Until Phase 5 ships an installable package, that's an alias for `bun run /path/to/shimwire/src/cli.ts` — e.g. `alias shimwire="bun run /path/to/shimwire/src/cli.ts"`.

## Quick start

```bash
# scaffold a project
cd my-project/
shimwire init
# creates .shimwire/{collections,env,mock}/

# backend not ready yet? mock it from the OpenAPI/Swagger spec
shimwire mock openapi.yaml --port 4000
# GET  /users   → 200
# POST /users   → 201

# backend exists? auto-scaffold a runnable test collection from the same spec
shimwire generate --from openapi.yaml --out users.toml

# run it against a real backend
shimwire run users.toml --env dev
# ✓ create_user   POST /users        201  142ms
# ✓ get_user      GET  /users/42     200  38ms

# wire into CI
shimwire run smoke.toml --env staging --fail-on-error

# get a readable HTML report instead of squinting at terminal lines
shimwire run users.toml --env dev --report report.html
```

## Commands

### `shimwire init`

Scaffolds `.shimwire/{collections,env,mock}/`, a starter `.shimwire/config.toml`, and a `.gitignore` entry protecting `.shimwire/env/*.toml` secrets.

### `shimwire cli`

Launches an interactive menu — pick "Mock", "Generate", "Run", or "Init" and answer a few validated prompts instead of remembering flags. Pre-fills answers from `.shimwire/config.toml` when present. Picking "Mock" starts the server in the background and returns to the menu, so you can immediately pick "Run" to test against it; after "Generate" it offers to run the collection it just wrote. Useful when you're exploring a new spec rather than scripting something repeatable.

### `shimwire mock [spec]`

Serves fake-but-schema-valid responses for every endpoint in a spec.

| Flag                   | Default                                    | Description                                                                                       |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `[spec]`               | —                                          | Path or URL to an OpenAPI 3.x / Swagger 2.0 spec. Falls back to `[mock].spec` in config.          |
| `-p, --port <port>`    | `4000`                                     | Port to listen on.                                                                                |
| `--overrides <path>`   | `.shimwire/mock/overrides.toml` if present | Force specific status codes, bodies, or latency.                                                  |
| `-l, --allow-local`    | off                                        | Allow fetching `spec` from localhost/private-network URLs (disables swagger-parser's SSRF guard). |
| `-k, --insecure`       | off                                        | Skip TLS certificate verification while fetching `spec` (self-signed local certs).                |
| `--cors` / `--no-cors` | CORS on                                    | Toggle permissive CORS headers.                                                                   |

### `shimwire generate`

Auto-scaffolds a runnable collection from a spec, guessing request chaining and pre-filling auth.

| Flag                          | Default                        | Description                                                                                  |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `-f, --from <spec>`           | —                              | Path or URL to an OpenAPI 3.x / Swagger 2.0 spec. Falls back to `[generate].from` in config. |
| `-o, --out <path>`            | —                              | Output path for the generated collection `.toml`. Falls back to `[generate].out`.            |
| `-s, --security <schemeName>` | first auto-configurable scheme | When a spec offers multiple auth alternatives, pin one by name.                              |
| `-l, --allow-local`           | off                            | Same SSRF-guard override as `mock`.                                                          |
| `-k, --insecure`              | off                            | Same TLS bypass as `mock`.                                                                   |

### `shimwire run <collection>`

Runs a collection against a real backend.

| Flag                  | Default | Description                                                                                                              |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `-e, --env <name>`    | `dev`   | Environment file under `.shimwire/env/<name>.toml`.                                                                      |
| `--only <id>`         | —       | Run a single request plus its dependencies.                                                                              |
| `--fail-on-error`     | off     | Exit non-zero if any request fails — for CI.                                                                             |
| `-k, --insecure`      | off     | Skip TLS certificate verification.                                                                                       |
| `-r, --report <path>` | —       | Write an HTML report (full request/response detail, sensitive headers redacted). Falls back to `[run].report` in config. |

## Configuration

`generate`, `run`, and `mock` all read defaults from a per-project `.shimwire/config.toml` — useful for a spec/backend you test against repeatedly. Any CLI flag you do pass overrides the corresponding config value; nothing else changes.

```toml
# .shimwire/config.toml
[generate]
from = "https://localhost:8080/api/v2/openapi.json"
out = ".shimwire/collections/api.toml"
security = "APIKeyAuth"
allow_local = true   # allow fetching `from` from localhost/private-network URLs
insecure = true       # skip TLS verification (self-signed local certs)

[run]
report = ".shimwire/reports/latest.html"   # always write a report, without passing --report

[mock]
spec = "https://localhost:8080/api/v2/openapi.json"
port = 4000
allow_local = true
insecure = true
cors = true
```

With that in place, `shimwire generate`, `shimwire run <collection>`, and `shimwire mock` all work with zero flags. `--allow-local` and `--insecure` disable safety checks (an SSRF guard and TLS certificate verification, respectively) meant for untrusted specs — only enable them for your own local/dev servers.

## Testing a frontend against the mock server

Point your frontend's API base URL at the mock server instead of a real backend:

```bash
shimwire mock openapi.yaml --port 4000
```

- **CORS is on by default** — a browser frontend running on a different origin/port (e.g. `localhost:5173` calling `localhost:4000`) works out of the box, including preflight `OPTIONS` requests. Pass `--no-cors` if you specifically want to test your frontend's own CORS failure handling.
- **Simulate edge cases** with `.shimwire/mock/overrides.toml` — force a specific status, inject artificial latency (loading states), or pin an exact response body, independently of each other:

  ```toml
  [[override]]
  path = "/users/{id}"
  method = "GET"
  status = 404              # force a not-found state
  when = "id == '999'"      # only for this specific id

  [[override]]
  path = "/users"
  method = "GET"
  latency_ms = 2000          # simulate a slow network without changing the response

  [[override]]
  path = "/users/{id}"
  method = "GET"
  body = { id = "1", name = "Ada Lovelace", status = "active" }  # pin an exact response
  ```

- Every other endpoint not covered by an override still returns schema-valid random data on every call, so your frontend gets realistic variety (different names, IDs, enum values) without you writing fixtures for all of it.

## Collection format

```toml
[meta]
name = "Users API"
base_url = "{{env.base_url}}"

[[request]]
id = "create_user"
method = "POST"
path = "/users"
[request.body]
name = "{{faker.name}}"
email = "{{faker.email}}"

[[request]]
id = "get_user"
method = "GET"
path = "/users/{{steps.create_user.response.id}}"
depends_on = ["create_user"]
```

Variables resolve from three sources: `env.*` (from `.shimwire/env/<name>.toml`), `faker.*` (any `@faker-js/faker` method path), and `steps.<id>.*` (a prior request's status/response in the same run).

## Errors & debugging

Every command fails with a single readable line (bad spec, missing config, port already in use, etc.) and exit code 1, instead of a raw stack trace. Set `SHIMWIRE_DEBUG=1` to see the full stack when you need it:

```bash
SHIMWIRE_DEBUG=1 shimwire mock ./bad-spec.yaml
```

## Roadmap

| Phase | What                                              | Status                                                                   |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 0     | Project setup, CI, `shimwire init`                | ✅ Done                                                                  |
| 1     | HTTP client / test runner (`shimwire run`)        | ✅ Done                                                                  |
| 2     | OpenAPI-driven mock server (`shimwire mock`)      | ✅ Done                                                                  |
| 3     | Collection auto-scaffolding (`shimwire generate`) | ✅ Done                                                                  |
| 4     | TUI                                               | Evaluated only if navigation becomes the real bottleneck after daily use |
| 5     | Polish & distribution (binaries, npm, Homebrew)   | Not started                                                              |

Full details, exit criteria, and estimates: [shimwire-implementation-plan.md](shimwire-implementation-plan.md).

## Stack

TypeScript on [Bun](https://bun.sh) · `commander` · `fastify` · `@fastify/cors` · `@apidevtools/swagger-parser` · `swagger2openapi` · `@faker-js/faker` · `smol-toml` · `zod` · `picocolors`

**Why Bun instead of Node/npm?** They're not the same category of tool — npm is a package manager for code that runs under Node, while Bun is a package manager _and_ a JS/TS runtime that replaces Node entirely. Specifically:

- Native TypeScript execution — `bun run src/cli.ts` just works, no build step or `ts-node`/`tsx` in the dev loop.
- Fast startup, which matters for a CLI invoked constantly, unlike a long-running server where startup cost is amortized.
- Built-in test runner (`bun test`, Jest-compatible), no separate test dependency.
- `bun build --compile` produces a single native binary per platform — the whole Phase 5 distribution story (download a binary, no Bun/Node install required to run it) depends on this.

The tradeoff: Bun's Node-compatibility is very good but not perfect. For this project's dependency list — all popular, well-maintained packages — that risk is low.

## Contributing

```bash
bun install
bun test
bun run lint
```

No formal process yet (this is a solo side project in its early days), but issues and PRs are welcome. The codebase is small enough to read in one sitting: `src/core/` for the shared engine, `src/commands/` for the CLI surface, `src/mockServer/` for the fastify-based mock. See [shimwire-implementation-plan.md](shimwire-implementation-plan.md) for the design rationale before proposing anything structural.

## License

MIT — see [LICENSE](LICENSE).
