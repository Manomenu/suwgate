---
"@maniumek/suwgate": minor
---

Two new repository guards, moved here from the apps' own gates:

- `test-timing` (`dotnet`, `web`, `library`): no test measures, sleeps on, waits for or limits real time; tests drive a fake
  clock. It replaces `TestTimingTests.cs` of suwagcms and suwchatbot, and also finds `CancelAfter`,
  `new CancellationTokenSource(<delay>)` and `WaitAsync(<TimeSpan>)`, which those copies let through.
- `human-docs` (every profile): `README.md`, `docs/development.md` and the README of a profile's directory never tell a
  person to run a script meant for agents (`scripts/.internal/`, `<name>.Gate/scripts/`); people run `just` recipes. It
  replaces alfusion's `HumanDocsTests.cs`.

What a repository must change when it upgrades: delete its own copies of these tests, then fix what the guards find (each
message states the fix), or give a finding an exception with its reason in `suwgate.yml`, such as an e2e setup script that
polls until the server answers, where the copies had a list of spared files.
