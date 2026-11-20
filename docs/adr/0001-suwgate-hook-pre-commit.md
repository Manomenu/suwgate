# 0001: suwgate ships `suwgate hook pre-commit`

## Context

The template and suwfrontkit each kept the same `.githooks/pre-commit`: gitleaks on the staged changes, refusing the commit when
gitleaks is missing. suwgate's own copy also ran the quick gate. Git runs a hook only from a file in the repository (the folder
`core.hooksPath` names), so some file stays in every repository either way; the question is how much of the rule lives in it.

## Decision

suwgate ships `suwgate hook pre-commit`, and a repository's `.githooks/pre-commit` is one line:

```sh
#!/usr/bin/env bash
exec node_modules/.bin/suwgate hook pre-commit
```

The command runs `gitleaks git --pre-commit --staged --no-banner --redact --log-level warn` (the form gitleaks' own pre-commit hook
uses), refuses the commit when gitleaks is missing or finds a secret, and then runs `suwgate check --quick`, refusing the commit
while it is red. The `hooks` guard checks that the file calls it, as it checks the two Claude Code hooks in `.claude/settings.json`.

## Why

- The rule (which gitleaks flags, what a missing gitleaks means, that a red quick gate is not committed) changes in one place and
  ships with a version, instead of drifting between copies; the same reason the Claude Code hooks became `suwgate hook` commands.
- It has tests like every other hook, instead of a script no test runs.
- The quick gate on a commit is what makes "a change with a red gate is not committed" true for people as well as agents; it has
  the same 20 second budget the Stop hook keeps.

## What it costs

- A repository needs the CLI installed to commit; a .NET-only repository waits for the decision in TODO.md on how it runs the CLI,
  and keeps its own gitleaks hook until then.
- `git commit --no-verify` still skips it, as it skips any hook; CI's `gitleaks` step is the backstop.
