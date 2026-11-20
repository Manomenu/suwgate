---
"@maniumek/suwgate": minor
---

The repository guards of the template and suwfrontkit move into the CLI: `agents-file`, `docs-paths`, `forbidden-names`,
`repository-layout`, `scripts-called`, `scripts-help` (full gate only), `just-modules`, `image-pins`, `compose-ports`,
`vscode-settings`, `banned-npm-packages`, `no-raw-colors`, and two new ones: `dependency-direction` (a library never depends at
runtime on an application; `settings.dependency-direction.forbidden` rules packages out of any repository) and `hooks` (the Claude
Code hooks and the git hook are wired). `required-files` now also asks for `suwgate.yml`, `criteria.json`, the VS Code settings and,
with `dotnet`, `layers.json`, and says what each missing file is for.

`suwgate hook guard-edit` guards only its own project and protects the gate files of the repository's profiles; `settings.hooks`
adds a repository's own gate files (`protected`), generated files with their command (`generated`), recorded tests
(`recordings`) and migration scripts (`migrations`). The new `suwgate hook pre-commit` runs gitleaks on the staged changes, then the
quick gate.

What a repository changes: its `.githooks/pre-commit` becomes `exec <suwgate> hook pre-commit`; a file the new guards report
is fixed, or gets an exception with its reason.
