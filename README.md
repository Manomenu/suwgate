# suwgate

One quality gate for every project: `suwgate check` runs the steps a project's profiles need and the repository guards, configured in `suwgate.yml`. The CLI is the npm package `@maniumek/suwgate`; the .NET guards are the NuGet packages `Suwgate.Architecture` and `Suwgate.Database`.

## Use it

```sh
pnpm add -D @maniumek/suwgate
pnpm exec suwgate check            # the whole gate, the same CI runs
pnpm exec suwgate check --quick    # the guards, and the quick steps for what changed since master
```

`suwgate.yml` in the repository root says what the repository is and where it departs from the defaults:

```yaml
profiles: [web, dotnet, database]
directories:
    web: Myapp.Web
steps:
    add:
        - name: api-diff
          run: scripts/.internal/api-diff.sh
          after: [dotnet-build]
    skip:
        - step: knip
          reason: the generated API client exports more than the app uses, and knip cannot tell
exceptions:
    - guard: architecture/interfaces-have-two-implementations
      target: Myapp.Server.Payments.IPaymentGateway
      reason: the payment SDK takes an implementation of this interface; the second one is the SDK's test double
```

- `profiles` (`web`, `library`, `dotnet`, `database`) bring their default steps in their order: build, tests, lint, typecheck,
  format, knip, the package checks of a library, shellcheck, gitleaks. A web-only repository runs nothing of .NET; the database
  guards run only with `database`.
- `steps.add` runs more (`name`, `run`, optionally `title`, `quick`, `after`, `limitSeconds`); `steps.skip` leaves a step out,
  always with a `reason`.
- `exceptions` let one target through one guard, always with a `reason`; `suwgate check` counts them in its report, and an
  exception that no longer matches anything fails the gate until it is deleted.
- The schema is in the package, `schema/suwgate.schema.json`. VS Code checks the file as you type with
  `"yaml.schemas": { "./node_modules/@maniumek/suwgate/schema/suwgate.schema.json": "suwgate.yml" }` in `.vscode/settings.json`.
- An agent cannot edit `suwgate.yml`: `suwgate hook guard-edit` (a Claude Code PreToolUse hook) refuses it, as it refuses the
  other files of the gate, until the owner starts a session with `ALLOW_GATE_EDIT=1`.

In the xUnit tests of a .NET application:

```csharp
[Fact]
public void Every_interface_has_two_implementations() =>
    Guards.Verify(InterfacesHaveTwoImplementations.Of(typeof(ServerApp).Assembly));
```

`Guards.Verify` reads the exceptions of that guard from the nearest `suwgate.yml` above the test's output folder.

`suwgate dev db|logs|smoke|server|tmux|checkout-env` runs the local stack of the template (database, logs, smoke test, server, tmux
session, worktree databases) from a `dev` section of `suwgate.yml`: [docs/dev.md](docs/dev.md).

## Work on suwgate

[AGENTS.md](AGENTS.md) holds the rules, [docs/development.md](docs/development.md) the setup, [docs/architecture.md](docs/architecture.md)
the contract of a guard and a step, and [docs/inventory.md](docs/inventory.md) what is still to be moved here from the template and the kits.

## Licence

MIT, see [LICENSE](LICENSE).
