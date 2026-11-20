set shell := ["bash", "-euo", "pipefail", "-c"]

[private]
default:
    @just --list --unsorted

# The whole gate on this repository, from the sources (suwgate check with profiles library and dotnet, the same CI runs)
[group('maintenance')]
check:
    node src/cli.ts check

# The quick gate: guards, and tsc, eslint, shellcheck, dotnet for what changed (what the Stop hook and pre-commit run)
[group('maintenance')]
check-quick:
    node src/cli.ts check --quick

# Build dist/ as it is published (tsc), then run the built CLI: just dist check
[group('dev')]
[positional-arguments]
dist *args:
    pnpm run build
    node dist/cli.js "$@"

# Pack the .NET guard packages (Suwgate.Architecture, Suwgate.Database) into .artifacts/nupkg; nothing is published
[group('dev')]
pack:
    dotnet pack Suwgate.slnx --nologo -o .artifacts/nupkg

# Describe a change of the CLI for the next release (a changeset); every change of src/ or schema/ needs one
[group('dev')]
changeset:
    pnpm changeset

# Format the code: Prettier for TypeScript, JSON, YAML and Markdown, CSharpier for C#
[group('maintenance')]
fmt:
    pnpm exec prettier --write --log-level warn .
    dotnet tool restore >/dev/null && dotnet csharpier format .

# Install packages and tools from the lockfiles, and enable the git hooks
[group('maintenance')]
sync:
    git config core.hooksPath .githooks
    pnpm install --frozen-lockfile
    dotnet tool restore
    dotnet restore Suwgate.slnx
