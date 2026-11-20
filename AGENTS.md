# AGENTS.md

Rules for anyone, human or AI agent, changing this repository. `CLAUDE.md` only points here;
this file is the one to edit. Setup: [docs/development.md](docs/development.md). Not built yet: [TODO.md](TODO.md).

This repository is suwgate, the one quality gate of the owner's repositories: the CLI `@maniumek/suwgate` on npmjs.com
and the .NET packages `Suwgate.Architecture` and `Suwgate.Database` (published from CI on a `nuget-v*` tag). Their
public surface (`suwgate.yml` and its schema, the commands, the guard ids, the public .NET types) is a contract with
every repository that installs them.

## Commands

- For people: a recipe in `justfile` with a one-line description; `just` lists them.
- For agents: `node src/cli.ts check --quick` while working, `node src/cli.ts check` before calling a change done. Both
  run suwgate on itself, from the sources, with the profiles `library` and `dotnet` of `suwgate.yml`.
- `node src/cli.ts --help` describes every command; `dotnet test` and `dotnet pack Suwgate.slnx -o .artifacts/nupkg` run the .NET side alone.

## Git

- The main branch is `master`, never `main`.
- Work on a feature branch, never on `master`. Agents do not rewrite or discard history: no
  amend, reset, rebase, stash, force-push or deleting an unmerged branch. Merging and releasing are the owner's.
- A branch merged into `master` is deleted right after the merge: local, remote and its worktree, with
  `git branch -d`, which refuses unmerged work.
- A change with a red gate is not committed: it stays in the working tree and the summary says why.
- One task, one branch. Unrelated refactors, renames, version bumps and fixes go to their own
  branch or into `TODO.md`; say so once when you reach for one, and put it in if the owner confirms.
- Personal rules (how you commit, your tools) go in the gitignored `CLAUDE.local.md`, not here.

## Releases

- Every change of `src/` or `schema/` carries a changeset (`just changeset`): patch for a fix, minor for something new,
  and while the version is 0.x also minor for a breaking change, with what a repository must change written in it.
- Agents never publish, log in to npm or NuGet, or push a release. CI publishes the CLI with npm trusted publishing after
  the owner merges the "Version Packages" pull request, and the .NET packages with NuGet trusted publishing after the owner pushes the tag `nuget-v<version>` ([docs/ci.md](docs/ci.md), [docs/first-release.md](docs/first-release.md)).

## Rules

- KISS and YAGNI first: suwgate grows only when a repository needs it; one developer maintains it after hours. When in doubt, leave it out, and say in the change what was left out and why.
- A new guard or step goes where [docs/architecture.md](docs/architecture.md) says, through the contract it describes; the gate in `src/gate/` does not change for it.
- A guard's message states the fix. A guard never decides an exception itself: it reports every finding, and `suwgate.yml` holds the exceptions, each with its reason.
- Plan a change by listing what it makes obsolete, and delete that first, in the same change.
- Correction or a new rule? Make the mistake impossible or loud first: a type, a lint, a test, a guard, a hook. Add a sentence here only for what none of these can check.
- Never weaken a guard to make a change pass: fix the change.

## No comments

No comments in project files: agents mostly use comments to excuse bad code and comments rot, so names, small functions, types and tests say what a comment would; if code is unclear without a comment, fix the code.

- Covered: every code and config file (TypeScript, JavaScript, C#, JSON, YAML, shell, justfile, MSBuild and XML files, ignore files, `.editorconfig`), JSDoc and `///` docs, commented-out code and task markers included. Not covered: Markdown, `docs/` and data strings (messages).
- Not scanned: lockfiles, `node_modules`, `dist`, `bin`, `obj`, `.artifacts`, `.changeset`, `docs/`.
- Allowed, because a tool reads them:
    - in a justfile, the one line directly above a recipe that `just --list` shows;
    - a shebang `#!` on the first line; `# shellcheck <directive>=…` in shell scripts;
    - `// @ts-expect-error <reason>` and `// @vitest-environment <env>`, only where nothing else works;
    - a comment that is exactly a criterion id where a criteria check reads it.
- `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `#pragma` and the null-forgiving `!` are banned outright; no comment excuses them.
- A reason that cannot live in code goes into a test, the README, this file or `docs/` as a sentence. Hints for `suwgate.yml` come from its schema
  through `yaml.schemas` in `.vscode/settings.json`, never from a `# yaml-language-server` comment.

## Review

A person also reads the diff when the change touches the always-careful list: the release workflow and publishing, the schema of
`suwgate.yml`, the contract of a guard or a step (`src/gate/contract.ts`, `dotnet/Suwgate.Architecture/Verification/`), and a guard id.

## Where code goes

[docs/architecture.md](docs/architecture.md). Read it before adding a folder, a guard or a step. What is still to be moved from the
template and the kits, and who moves it: [docs/inventory.md](docs/inventory.md).
Docs say what and why, not where: a line that must change when the code moves does not belong in the docs.

## What no test can check

- Names are chosen word by word, in technical English; one word per thing, everywhere (an exception is an exception, in YAML and in C#).
- Secrets never enter the repo: not in code, settings, tests or history. A real hit is removed and rotated, never allow-listed.
