---
"@maniumek/suwgate": minor
---

- `test-timing` also finds `TimeProvider.System` in a test (the real clock: hand the code a `FakeTimeProvider`) and a
  `TimeSpan.From…` or `new TimeSpan(…)` handed to a constructor that gets no `TimeProvider` (a real-time interval). A ceiling
  against a hang stays allowed: `new CancellationTokenSource(<delay>)`, `CancelAfter`, `WaitAsync(<TimeSpan>)` and now, said
  explicitly, an `HttpClient`'s `Timeout`. A repository may get new findings; fix them with a `FakeTimeProvider`.
- `suwgate dev server` and `suwgate dev tmux` find the server project themselves when `dev.server.project` is not set: the one
  `.csproj` on `Sdk="Microsoft.NET.Sdk.Web"` in `directories.dotnet`, or in the repository. With none or several they stop and name
  the candidates. `directories.dotnet` alone no longer names the server project: a repository that relied on it either has its one
  web project there (nothing to do) or sets `dev.server.project`.
- `suwgate dev logs` without a log names the repository's own recipes that start the stack and the server (`just tmux-dev start`,
  `just server`) instead of the CLI commands.
- The .NET guards honour `message` and `once` on an exception, as the repository guards do, from `Suwgate.Architecture` 0.4.0:
  `suwgate.yml` no longer refuses them on an `architecture/*` or `database/*` exception, and the report asks to delete a one-time
  exception of a .NET guard once master has it. Take `Suwgate.Architecture` and `Suwgate.Database` 0.4.0 with this version: an
  older package ignores `message` and excepts every finding of the target.
