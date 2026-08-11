# Regenerate assets/mcp-demo.gif for the README:
#   brew install vhs
#   vhs assets/mcp-demo.tape
# Run from the repo root. This drives the real `shimwire mcp` server over
# real stdio JSON-RPC via assets/mcp-demo-client.ts (a minimal MCP client
# standing in for an AI agent) — nothing here is fabricated output.

Output "assets/mcp-demo.gif"

Require bun

Set Shell "zsh"
Set FontSize 15
Set FontFamily "Menlo"
Set Width 1080
Set Height 820
Set Padding 20
Set Margin 30
Set MarginFill "#0d1117"
Set BorderRadius 10
Set WindowBar Colorful
Set WindowBarSize 36
Set Theme "Dracula"
Set TypingSpeed 45ms

Hide
Type 'ROOT=$PWD'
Enter
Type 'rm -rf /tmp/shimwire-mcp-demo && mkdir -p /tmp/shimwire-mcp-demo/.shimwire/env && cp tests/fixtures/auth-demo.openapi.yaml /tmp/shimwire-mcp-demo/openapi.yaml && cp assets/mcp-demo-client.ts /tmp/shimwire-mcp-demo/mcp-demo-client.ts'
Enter
Type 'shimwire() { bun run "$ROOT/src/cli.ts" "$@"; }'
Enter
Type 'export SHIMWIRE_CLI_PATH="$ROOT/src/cli.ts"'
Enter
Type 'cd /tmp/shimwire-mcp-demo'
Enter
Type 'printf "base_url = \"http://localhost:4700\"\n" > .shimwire/env/dev.toml'
Enter
Type 'shimwire mock ./openapi.yaml --port 4700 --no-watch > mock.log 2>&1 &'
Enter
Sleep 1500ms
Type 'clear'
Enter
Sleep 300ms
Show

# First, the real command from the README/Claude config, run directly, so
# it's clear this isn't a stand-in for something else — it's the actual
# server. It just sits on stdio waiting for a client, so there isn't more
# to see here without one.
Type "shimwire mcp"
Enter
Sleep 2000ms
Ctrl+C
Sleep 500ms
Type 'clear'
Enter
Sleep 300ms

# A raw server has nothing to demo without a client talking to it — this is
# that client. mcp-demo-client.ts (assets/mcp-demo-client.ts, not a shimwire
# subcommand) is a minimal, real MCP client standing in for an AI agent: it
# spawns its own `shimwire mcp` and drives it over stdio, same as above.
Type "bun run mcp-demo-client.ts"
Enter
Sleep 11000ms
