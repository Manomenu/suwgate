---
"@maniumek/suwgate": minor
---

CI that runs once per tree, and one smoke test for every stack.

- `suwgate dev smoke --ci` builds and starts the whole compose stack as its own project `<dev.name>-ci` with the image tag `ci`,
  moves every published port to a free loopback port (an override generated from `docker compose config`), smoke-tests the port
  that stands for `dev.ports.stack`, prints the logs on failure and always removes the project with its volumes, also when the job
  is cancelled. A repository deletes its `compose.ci.yaml`.
- The `database-up` step starts the database in CI as well (it used to leave it to the workflow), through `suwgate dev db up`
  whenever `suwgate.yml` has a `dev` section, so the compose database and `dev.database.up` start the same way everywhere.
- `gate.yml` (pin the new commit): a `proof` job skips the gate on a push whose tree already passed (a green `ci/tree` commit status
  that a `stamp` job writes after every green run), PR runs cancel their superseded predecessors (no caller `concurrency` needed),
  `smoke: true` runs the stack smoke test, `browser: chromium` replaces the two browser inputs, and the runner, the command, .NET,
  oasdiff and the database come from the repository. What a caller changes: grant the gate job `statuses: write` and
  `pull-requests: read` next to `contents: read` (without them the workflow does not start), drop `runs-on`, `command`, `dotnet`,
  `oasdiff`, `database`, `database-command` and the browser commands, and replace its own `build` job by `smoke: true` (and
  `smoke-env` for variables the stack needs). The old inputs still work in this release and go in the next minor one.
