# shimwire

**One tool for both sides of an API you don't fully control yet: mock the parts that aren't built, and test the parts that are.**

`shimwire` reads an OpenAPI spec and gives you two things from it:

- 🧪 **Mock mode** — spins up a fake-but-schema-valid API server, so frontend work isn't blocked waiting on a backend.
- 🚀 **Client mode** — a scriptable, git-friendly HTTP test runner. Collections are version-controlled TOML files you can diff and review in a PR, not JSON blobs locked in a proprietary cloud tool.

Both modes are powered by the same core engine — one OpenAPI parser, one schema-aware fake-data generator, one variable/templating resolver — so a mock server and a test collection for the same API never drift out of sync with each other.

> **Status: early days, but functional end-to-end.** `shimwire init`, `run`, `mock`, and `generate` all work — you can point `generate` at an OpenAPI spec to get a runnable collection, then run it straight against `mock` serving the same spec. See [shimwire-implementation-plan.md](shimwire-implementation-plan.md) for the full architecture, phased build plan, and rationale. Star/watch the repo to follow progress — issues and design feedback are welcome.

---

## Why

Postman/Insomnia-style tools lock collections into proprietary formats that don't diff cleanly in git and don't run well in CI. Meanwhile, mocking a backend usually means hand-rolling fixtures that quietly drift from the real API contract. If you already have an OpenAPI spec, both problems have the same fix: derive the mock _and_ the test collection from that one source of truth.

- **Git-native** — collections and environments are plain TOML files, reviewable in a normal PR diff.
- **CI-friendly** — `shimwire run` exits non-zero on failure, no separate CI runner or cloud sync needed.
- **Spec-driven** — mocks and generated collections both come from your OpenAPI spec, so they can't disagree with each other.
- **Single binary** — ships as a compiled binary via `bun build --compile`; no Node/Bun install required to just run it.

## Planned usage

```bash
# install
bun install -g shimwire
# or grab a compiled binary from GitHub Releases — no runtime required

# scaffold a project
cd my-project/
shimwire init
# creates .shimwire/{collections,env,mock}/

# backend not ready yet? mock it from the OpenAPI spec
shimwire mock openapi.yaml --port 4000
# GET  /users   → 200
# POST /users   → 201

# backend exists? auto-scaffold a test collection from the same spec
shimwire generate --from openapi.yaml --out users.toml

# run it against a real backend
shimwire run users.toml --env dev
# ✓ create_user   POST /users        201  142ms
# ✓ get_user      GET  /users/42     200  38ms

# wire into CI
shimwire run smoke.toml --env staging --fail-on-error
```

A collection looks like this:

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

TypeScript on [Bun](https://bun.sh) · `commander` · `fastify` · `@apidevtools/swagger-parser` · `@faker-js/faker` · `smol-toml` · `picocolors`

**Why Bun instead of Node/npm?** They're not really the same category of tool — npm is a package manager for code that runs under Node, while Bun is a package manager _and_ a JS/TS runtime that replaces Node entirely. Reasons this project uses it specifically:

- Native TypeScript execution — `bun run src/cli.ts` just works, no build step or `ts-node`/`tsx` in the dev loop.
- Fast startup, which matters for a CLI invoked constantly, unlike a long-running server where startup cost is amortized.
- Built-in test runner (`bun test`, Jest-compatible), no separate test dependency.
- `bun build --compile` produces a single native binary per platform — the whole Phase 5 distribution story (download a binary, no Bun/Node install required to run it) depends on this.

The tradeoff: Bun's Node-compatibility is very good but not perfect. For this project's dependency list (`commander`, `fastify`, `zod`, `@faker-js/faker`, `smol-toml` — all popular, well-maintained) that risk is low.

## Contributing

Not yet open for contributions — there's no code to contribute to. Once Phase 0 lands, this section will cover setup and dev workflow. In the meantime, feedback on the design in the implementation plan is welcome via issues.

## License

MIT — see [LICENSE](LICENSE).
