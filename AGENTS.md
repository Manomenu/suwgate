# AGENTS.md

Rules for anyone, human or AI agent, changing this repository. `CLAUDE.md` only points here;
this file is the one to edit. Setup: [docs/development.md](docs/development.md). Not built yet: [TODO.md](TODO.md).

Read @AGENTS.shared.md first: the rules every repository of the stack shares. This file adds this repository's own and wins where it says otherwise.

This repository is suwgate, the one quality gate of the owner's repositories: the CLI `@maniumek/suwgate` on npmjs.com
and the .NET packages `Suwgate.Architecture` and `Suwgate.Database` (published from CI on a `nuget-v*` tag). Their
public surface (`suwgate.yml` and its schema, the commands, the guard ids, the public .NET types, `AGENTS.shared.md`) is a
contract with every repository that installs them. `AGENTS.shared.md` here is the source of every copy: a shared rule changes here.

## Commands

- For agents: `node src/cli.ts check --quick` while working, `node src/cli.ts check` before calling a change done. Both
  run suwgate on itself, from the sources, with the profiles `library` and `dotnet` of `suwgate.yml`.
- `node src/cli.ts step <id> [-- <args>]` runs one step with the steps it needs, e.g. `node src/cli.ts step unit-tests -- -t "name"`.
- `node src/cli.ts --help` describes every command; `dotnet test` and `dotnet pack Suwgate.slnx -o .artifacts/nupkg` run the .NET side alone.

## Releases

- Every change of `src/`, `schema/` or `AGENTS.shared.md` carries a changeset (`just changeset`): patch for a fix, minor for something
  new, and while the version is 0.x also minor for a breaking change, with what a repository must change written in it.
- CI publishes the CLI with npm trusted publishing after the "Version Packages" pull request is merged, and the .NET packages with
  NuGet trusted publishing after the tag `nuget-v<version>` is pushed ([docs/ci.md](docs/ci.md), [docs/first-release.md](docs/first-release.md)).

## Rules

- suwgate grows only when a repository needs it.
- A new guard or step goes where [docs/architecture.md](docs/architecture.md) says, through the contract it describes; the gate in `src/gate/` does not change for it.
- A guard never decides an exception itself: it reports every finding, and `suwgate.yml` holds the exceptions, each with its reason.
- Not scanned for comments, besides the shared list: `.changeset`. Hints for `suwgate.yml` come from its schema through
  `yaml.schemas` in `.vscode/settings.json`, never from a `# yaml-language-server` comment.
- Names are in technical English; an exception is an exception, in YAML and in C#.

## Review

A person also reads the diff when the change touches the always-careful list: the release workflow and publishing, the schema of
`suwgate.yml`, the contract of a guard or a step (`src/gate/contract.ts`, `dotnet/Suwgate.Architecture/Verification/`), a guard id,
and `AGENTS.shared.md`.

## Where code goes

What is still to be moved from the template and the kits, and who moves it: [docs/inventory.md](docs/inventory.md).
