# Regenerate assets/terminal-demo.gif for the README:
#   brew install vhs
#   vhs assets/terminal-demo.tape
# Run from the repo root. Everything below is a real, unmodified shimwire
# session against tests/fixtures/petstore.openapi.yaml — no fabricated output.

Output "assets/terminal-demo.gif"

Require bun

Set Shell "zsh"
Set FontSize 16
Set FontFamily "Menlo"
Set Width 1000
Set Height 640
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
Type 'rm -rf /tmp/shimwire-demo && mkdir -p /tmp/shimwire-demo && cp tests/fixtures/petstore.openapi.yaml /tmp/shimwire-demo/openapi.yaml'
Enter
Type 'shimwire() { bun run "$ROOT/src/cli.ts" "$@"; }'
Enter
Type 'cd /tmp/shimwire-demo'
Enter
Type 'clear'
Enter
Sleep 500ms
Show

Type "shimwire init"
Enter
Sleep 1500ms

Type "shimwire mock ./openapi.yaml --port 4100 --no-watch &"
Enter
Sleep 2000ms

Hide
Type 'printf "base_url = \"http://localhost:4100\"\ntoken = \"demo-token\"\n" > .shimwire/env/dev.toml'
Enter
Type 'printf "base_url = \"http://localhost:4999\"\ntoken = \"demo-token\"\n" > .shimwire/env/staging.toml'
Enter
Type 'clear'
Enter
Sleep 500ms
Show

Type "shimwire generate --from ./openapi.yaml --out .shimwire/collections/pets.toml"
Enter
Sleep 2000ms

Type "shimwire run .shimwire/collections/pets.toml --env dev"
Enter
Sleep 2000ms

Type "shimwire run .shimwire/collections/pets.toml --env staging --fail-on-error"
Enter
Sleep 1500ms

Type "echo $?"
Enter
Sleep 3000ms
