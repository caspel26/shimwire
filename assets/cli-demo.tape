# Regenerate assets/cli-demo.gif for the README:
#   brew install vhs
#   vhs assets/cli-demo.tape
# Run from the repo root. This is a real, unmodified `shimwire cli` session
# (the guided interactive menu) against tests/fixtures/petstore.openapi.yaml.
# Menu order: Mock, Generate, Workflow, Run, Init, MCP, (separator), Exit.

Output "assets/cli-demo.gif"

Require bun

Set Shell "zsh"
Set FontSize 16
Set FontFamily "Menlo"
Set Width 1000
Set Height 700
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
Type 'rm -rf /tmp/shimwire-cli-demo && mkdir -p /tmp/shimwire-cli-demo && cp tests/fixtures/petstore.openapi.yaml /tmp/shimwire-cli-demo/openapi.yaml'
Enter
Type 'shimwire() { bun run "$ROOT/src/cli.ts" "$@"; }'
Enter
Type 'cd /tmp/shimwire-cli-demo'
Enter
Type 'clear'
Enter
Sleep 500ms
Show

# launch the guided menu, scaffold the project first
Type "shimwire cli"
Enter
Sleep 1200ms
Down 4
Sleep 400ms
Enter
Sleep 1200ms
Enter
Sleep 800ms

# back at the menu (nothing running yet) — exit so we can point the
# freshly-scaffolded dev env at our mock port
Down 6
Sleep 400ms
Enter
Sleep 800ms

Hide
Type 'printf "base_url = \"http://localhost:4000\"\ntoken = \"demo-token\"\n" > .shimwire/env/dev.toml'
Enter
Type 'clear'
Enter
Sleep 500ms
Show

# relaunch: Mock the spec
Type "shimwire cli"
Enter
Sleep 1200ms
Enter
Sleep 600ms
Type "./openapi.yaml"
Sleep 300ms
Enter
Sleep 500ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 1500ms
Enter
Sleep 800ms

# back at the menu (now showing the running mock) — Generate a collection
Down 1
Sleep 400ms
Enter
Sleep 800ms
Type "./openapi.yaml"
Sleep 300ms
Enter
Sleep 500ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 1500ms
Enter
Sleep 500ms

# offered to run it immediately — accept, then answer the run prompts
Enter
Sleep 500ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 400ms
Enter
Sleep 2000ms
Enter
Sleep 800ms

# back at the menu — Workflow: pick create_pet from the checkbox list and
# save it as a reusable workflow
Down 2
Sleep 400ms
Enter
Sleep 800ms
Type "./openapi.yaml"
Sleep 300ms
Enter
Sleep 500ms
Enter
Sleep 400ms
Enter
Sleep 1000ms
Down 1
Sleep 300ms
Space
Sleep 300ms
Enter
Sleep 500ms
Type "pets_flow"
Enter
Sleep 1500ms
Enter
Sleep 800ms

# back at the menu — MCP: show the connection config for an AI client
Down 5
Sleep 400ms
Enter
Sleep 1200ms
Enter
Sleep 800ms

# exit — stops the background mock server too
Down 6
Sleep 400ms
Enter
Sleep 1500ms
