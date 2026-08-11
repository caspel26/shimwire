# Regenerate assets/workflow-demo.gif for the README:
#   brew install vhs
#   vhs assets/workflow-demo.tape
# Run from the repo root. Everything below is a real, unmodified shimwire
# session against tests/fixtures/auth-demo.openapi.yaml — no fabricated output.

Output "assets/workflow-demo.gif"

Require bun

Set Shell "zsh"
Set FontSize 16
Set FontFamily "Menlo"
Set Width 1000
Set Height 620
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
Type 'rm -rf /tmp/shimwire-workflow-demo && mkdir -p /tmp/shimwire-workflow-demo/.shimwire/workflows /tmp/shimwire-workflow-demo/.shimwire/collections /tmp/shimwire-workflow-demo/.shimwire/env && cp tests/fixtures/auth-demo.openapi.yaml /tmp/shimwire-workflow-demo/openapi.yaml'
Enter
Type 'shimwire() { bun run "$ROOT/src/cli.ts" "$@"; }'
Enter
Type 'cd /tmp/shimwire-workflow-demo'
Enter
Type 'printf "base_url = \"http://localhost:4300\"\n" > .shimwire/env/dev.toml'
Enter
Type 'printf "[[request]]\nid = \"login\"\nmethod = \"POST\"\npath = \"/auth/login\"\n" > .shimwire/workflows/authentication_flow.toml'
Enter
Type 'printf "[meta]\nname = \"Users API\"\nbase_url = \"{{env.base_url}}\"\ninclude = [\"authentication_flow\"]\n\n[[request]]\nid = \"get_user\"\nmethod = \"GET\"\npath = \"/users/42\"\ndepends_on = [\"login\"]\n[request.headers]\nAuthorization = \"Bearer {{steps.login.response.token}}\"\n" > .shimwire/collections/users.toml'
Enter
Type 'shimwire mock ./openapi.yaml --port 4300 --no-watch &'
Enter
Sleep 1500ms
Type 'clear'
Enter
Sleep 300ms
Show

Type "cat .shimwire/workflows/authentication_flow.toml"
Enter
Sleep 1800ms

Type "cat .shimwire/collections/users.toml"
Enter
Sleep 2200ms

Type "shimwire run .shimwire/collections/users.toml --env dev"
Enter
Sleep 2500ms
