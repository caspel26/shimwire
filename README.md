<div align="center">

<img src="assets/logo-light.png" alt="shimwire" width="420">

**One tool for both sides of an API you don't fully control yet: mock the parts that aren't built, and test the parts that are.**

[![CI](https://github.com/caspel26/shimwire/actions/workflows/ci.yml/badge.svg)](https://github.com/caspel26/shimwire/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-f472b6.svg)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

<img src="assets/terminal-demo.gif" alt="Terminal recording of shimwire init, mock, generate, and run — including run catching a broken staging environment and exiting non-zero for CI." width="700">

</div>

`shimwire` reads an OpenAPI 3.x or Swagger 2.0 spec (older specs are converted automatically) and gives you two things from it, powered by one shared engine so they never drift apart:

- 🧪 **Mock mode** — a fake-but-schema-valid API server, so frontend work isn't blocked waiting on a backend.
- 🚀 **Client mode** — a scriptable, git-friendly HTTP test runner. Collections are version-controlled TOML files you can diff and review in a PR, not JSON blobs locked in a proprietary cloud tool.

> **Status:** functional end-to-end (Phases 0–3 of the [implementation plan](shimwire-implementation-plan.md) are done). Not yet published as an installable package — run it from source for now. **Issues, ideas, and PRs are genuinely welcome** — see [Contributing](#-contributing).

---

## Table of contents

- [✨ Features](#-features)
- [🤔 Why](#-why)
- [📦 Installation](#-installation)
- [🚀 Quick start](#-quick-start)
- [🧰 Commands](#-commands)
- [⚙️ Configuration](#️-configuration)
- [🖥️ Testing a frontend against the mock server](#️-testing-a-frontend-against-the-mock-server)
- [📄 Collection format](#-collection-format)
- [🩹 Errors & debugging](#-errors--debugging)
- [🗺️ Roadmap](#️-roadmap)
- [🏗️ Stack](#️-stack)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)

## ✨ Features

- 🔀 **Spec-driven** — mock server and test collections both come from the same OpenAPI/Swagger spec, so they can never disagree with each other.
- 📁 **Git-native collections** — plain TOML, reviewable in a normal PR diff, no proprietary cloud format.
- 🌐 **CORS-ready mock server** — on by default, so a browser frontend on another port just works.
- 📡 **Live request log** — watch your frontend's traffic hit the mock in real time.
- 🎭 **Realistic fake data** — schema-aware (respects `type`, `format`, `enum`, `min`/`max`), not just random junk.
- 🎯 **Overrides** — force a specific status, inject latency, or pin an exact response for edge-case testing.
- 🤖 **Auto-scaffolding** — `generate` builds a runnable collection from your spec, guessing request chaining and pre-filling auth.
- 🖱️ **Interactive CLI** — a guided menu (`shimwire cli`) for exploring a spec without memorizing flags.
- 📊 **HTML reports** — readable request/response detail for `run`, not just terminal noise.
- 🩺 **Clean errors** — one readable line and exit code 1 on failure, not a raw stack trace.

## 🤔 Why

Postman/Insomnia-style tools lock collections into proprietary formats that don't diff cleanly in git and don't run well in CI. Meanwhile, mocking a backend usually means hand-rolling fixtures that quietly drift from the real API contract. If you already have an OpenAPI (or Swagger 2.0) spec, both problems have the same fix: derive the mock _and_ the test collection from that one source of truth — see [Features](#-features) above for what that gets you in practice.

## 📦 Installation

Not published to npm yet — run it from source:

```bash
git clone https://github.com/caspel26/shimwire
cd shimwire
bun install
bun run src/cli.ts <command>
```

(A `bun install -g shimwire` / compiled-binary install path is planned for Phase 5 — see the [Roadmap](#️-roadmap).)

> The examples below use a bare `shimwire` for readability. Until Phase 5 ships an installable package, that's an alias for `bun run /path/to/shimwire/src/cli.ts` — e.g. `alias shimwire="bun run /path/to/shimwire/src/cli.ts"`.

## 🚀 Quick start

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

Prefer answering a few prompts instead of remembering flags? Try `shimwire cli` for a guided interactive menu.

<details>
<summary><strong>Full transcript</strong> (text version of the recording above)</summary>

```console
$ shimwire init
Created .shimwire/ in my-project
  .shimwire/collections/
  .shimwire/env/
  .shimwire/mock/
  .shimwire/config.toml (commented-out defaults for generate/run/mock)
  .gitignore (created — keeps .shimwire/env/*.toml out of git)

$ shimwire mock ./openapi.yaml --port 4100 --no-watch &
Loading spec from ./openapi.yaml...
Mock server running on http://localhost:4100
  GET    /pets  → 200
  POST   /pets  → 201
  GET    /pets/{id}  → 200

$ shimwire generate --from ./openapi.yaml --out .shimwire/collections/pets.toml
Loading OpenAPI spec from ./openapi.yaml...
Loaded "Petstore" — 2 path(s)
Generating collection...
Writing .shimwire/collections/pets.toml...
Wrote 3 request(s) to .shimwire/collections/pets.toml
1 item(s) flagged for manual review — see file header.

$ shimwire run .shimwire/collections/pets.toml --env dev
✓ list_pets       GET    /pets  200  7ms
✓ create_pet      POST   /pets  201  1ms
✓ get_pet         GET    /pets/44bf8c98-8527-4f60-b5d0-3b68dca9685a  200  0ms

$ shimwire run .shimwire/collections/pets.toml --env staging --fail-on-error
✗ list_pets       Unable to connect. Is the computer able to access the url?
✗ create_pet      Unable to connect. Is the computer able to access the url?
✗ get_pet         Unknown or not-yet-run step "steps.create_pet"

$ echo $?
1
```

That last block is the whole point: the same collection that runs clean against `dev` catches a broken `staging` environment, and the nonzero exit code is exactly what `--fail-on-error` is for in a CI job.

</details>

## 🧰 Commands

### `shimwire init`

Scaffolds `.shimwire/{collections,env,mock}/`, a starter `.shimwire/config.toml`, and a `.gitignore` entry protecting `.shimwire/env/*.toml` secrets.

### `shimwire cli`

Launches an interactive menu — pick "Mock", "Generate", "Run", or "Init" and answer a few validated prompts instead of remembering flags. Pre-fills answers from `.shimwire/config.toml` when present. Picking "Mock" starts the server in the background and returns to the menu, so you can immediately pick "Run" to test against it; after "Generate" it offers to run the collection it just wrote. Useful when you're exploring a new spec rather than scripting something repeatable.

<p align="center">
  <img src="assets/cli-demo.gif" alt="Terminal recording of the shimwire cli guided menu: scaffolding a project, starting a mock server, generating a collection, and running it — all from prompts instead of flags." width="700">
</p>

### `shimwire mock [spec]`

Serves fake-but-schema-valid responses for every endpoint in a spec.

| Flag                     | Default                                    | Description                                                                                       |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `[spec]`                 | —                                          | Path or URL to an OpenAPI 3.x / Swagger 2.0 spec. Falls back to `[mock].spec` in config.          |
| `-p, --port <port>`      | `4000`                                     | Port to listen on.                                                                                |
| `--overrides <path>`     | `.shimwire/mock/overrides.toml` if present | Force specific status codes, bodies, or latency.                                                  |
| `-l, --allow-local`      | off                                        | Allow fetching `spec` from localhost/private-network URLs (disables swagger-parser's SSRF guard). |
| `-k, --insecure`         | off                                        | Skip TLS certificate verification while fetching `spec` (self-signed local certs).                |
| `--cors` / `--no-cors`   | CORS on                                    | Toggle permissive CORS headers.                                                                   |
| `--watch` / `--no-watch` | watch on                                   | Toggle a live log line (time, method, path, status, duration) for every incoming request.         |

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

## ⚙️ Configuration

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

## 🖥️ Testing a frontend against the mock server

Point your frontend's API base URL at the mock server instead of a real backend:

```bash
shimwire mock openapi.yaml --port 4000
```

- **CORS is on by default** — a browser frontend running on a different origin/port (e.g. `localhost:5173` calling `localhost:4000`) works out of the box, including preflight `OPTIONS` requests. Pass `--no-cors` if you specifically want to test your frontend's own CORS failure handling.
- **Watch traffic live** — every incoming request prints a colored line (time, method, path, status, duration) so you can see exactly what your frontend is calling. Pass `--no-watch` to quiet it down.
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

## 📄 Collection format

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

## 🩹 Errors & debugging

Every command fails with a single readable line (bad spec, missing config, port already in use, etc.) and exit code 1, instead of a raw stack trace. Set `SHIMWIRE_DEBUG=1` to see the full stack when you need it:

```bash
SHIMWIRE_DEBUG=1 shimwire mock ./bad-spec.yaml
```

## 🗺️ Roadmap

| Phase | What                                              | Status                                                                   |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 0     | Project setup, CI, `shimwire init`                | ✅ Done                                                                  |
| 1     | HTTP client / test runner (`shimwire run`)        | ✅ Done                                                                  |
| 2     | OpenAPI-driven mock server (`shimwire mock`)      | ✅ Done                                                                  |
| 3     | Collection auto-scaffolding (`shimwire generate`) | ✅ Done                                                                  |
| 4     | TUI                                               | Evaluated only if navigation becomes the real bottleneck after daily use |
| 5     | Polish & distribution (binaries, npm, Homebrew)   | Not started                                                              |

Full details, exit criteria, and estimates: [shimwire-implementation-plan.md](shimwire-implementation-plan.md).

## 🏗️ Stack

TypeScript on [Bun](https://bun.sh) · `commander` · `fastify` · `@fastify/cors` · `@apidevtools/swagger-parser` · `swagger2openapi` · `@faker-js/faker` · `smol-toml` · `zod` · `picocolors`

**Why Bun instead of Node/npm?** They're not the same category of tool — npm is a package manager for code that runs under Node, while Bun is a package manager _and_ a JS/TS runtime that replaces Node entirely. Specifically:

- Native TypeScript execution — `bun run src/cli.ts` just works, no build step or `ts-node`/`tsx` in the dev loop.
- Fast startup, which matters for a CLI invoked constantly, unlike a long-running server where startup cost is amortized.
- Built-in test runner (`bun test`, Jest-compatible), no separate test dependency.
- `bun build --compile` produces a single native binary per platform — the whole Phase 5 distribution story (download a binary, no Bun/Node install required to run it) depends on this.

The tradeoff: Bun's Node-compatibility is very good but not perfect. For this project's dependency list — all popular, well-maintained packages — that risk is low.

## 🤝 Contributing

Contributions of any size are welcome — a typo fix, a bug report, a new override capability, or a completely different perspective on the design. This is a solo side project in its early days, so there's no formal process to navigate:

1. **Found a bug or have an idea?** [Open an issue](https://github.com/caspel26/shimwire/issues) — even a rough one is useful.
2. **Want to send a PR?** Fork, branch, and:
   ```bash
   bun install
   bun test
   bun run lint
   ```
   Make sure both pass before opening the PR. Small, focused PRs are easiest to review and merge.
3. **Not sure where to start?** The codebase is small enough to read in one sitting: `src/core/` for the shared engine (parser, faker, variable resolver), `src/commands/` for the CLI surface, `src/mockServer/` for the fastify-based mock. Read [shimwire-implementation-plan.md](shimwire-implementation-plan.md) for the design rationale before proposing anything structural — it explains _why_ things are built the way they are, which saves a round-trip on bigger changes.

If you use shimwire and it helps you, a ⭐ on the repo is genuinely appreciated — it's a good signal that iterating on this is worth the time.

## 📜 License

MIT — see [LICENSE](LICENSE).
