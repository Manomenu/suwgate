# suwgate dev

`suwgate dev` is the template's dev scripts (`scripts/.internal/db.sh`, `logs.sh`, `smoke.sh`, `server.sh`, `tmux-dev.sh`,
`checkout-env.sh`) as subcommands of the CLI. They had been copied into every repository made from the template and had
started to drift (restart loop of the server, tmux pane detection, the database commands, the pinned image check). The
command takes the most solid behaviour of the copies of the template, alfusion, suwagcms and suwageval, and reads what differs
between repositories (names, ports, folders) from `suwgate.yml`. Nothing app-specific is in the CLI.

```sh
suwgate dev db up|down|reset|psql|logs|status   # the local PostgreSQL of the compose file, or of dev.database.up and psql
suwgate dev logs [--all] [--trace <id>] [--compose] [-n N] [--file <path>]
suwgate dev smoke [<base-url>]
suwgate dev server [dotnet run arguments]
suwgate dev tmux start [--restart] | stop
eval "$(suwgate dev checkout-env)"
```

Every command takes `--help`, which works without a `dev` section. Exit codes: 0 done, 1 failed (a smoke check, a missing log,
the database did not start), 2 a usage problem or a problem of `suwgate.yml`.

## The `dev` section of suwgate.yml

```yaml
directories:
    dotnet: Myapp.Server
    web: Myapp.Web
dev:
    name: myapp
    portOffset: 60
```

Only `name` is required. The schema (`schema/suwgate.schema.json`) lists every key; the defaults are below.

| Key                                   | Default                                             | Used by                                                                                                                           |
| :------------------------------------ | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                | required                                            | the tmux session `<name>-dev`; the database user, password and name                                                               |
| `portOffset`                          | `0`                                                 | added to every default port, so repositories on one machine do not collide                                                        |
| `ports.server` / `web`                | `6300` / `3300` (+ offset)                          | the titles of the tmux panes                                                                                                      |
| `ports.e2eServer` / `e2eWeb`          | `6301` / `3301` (+ offset)                          | `checkout-env`: the e2e ports of the main checkout                                                                                |
| `ports.database`                      | `5533` (+ offset)                                   | the address `db up` prints, the test connection string of `checkout-env`                                                          |
| `ports.stack`                         | `8190` (+ offset)                                   | `smoke`: the base url `http://127.0.0.1:<port>`                                                                                   |
| `compose.file`                        | `compose.yaml`                                      | `db`, `logs --compose`                                                                                                            |
| `compose.profile`                     | `db`                                                | the compose profile of the database                                                                                               |
| `compose.databaseService`             | `db`                                                | the PostgreSQL service                                                                                                            |
| `compose.serverService`               | `server`                                            | `logs --compose`                                                                                                                  |
| `compose.extraServices`               | none                                                | started and stopped with the database, e.g. `[mail]`                                                                              |
| `database.user` / `password` / `name` | `name`                                              | `db psql`, the address, the database names of `checkout-env`                                                                      |
| `database.up`                         | the compose service                                 | `db up`, the `database-up` and `e2e` steps: a bash command, run in the root, that starts the database and returns once it answers |
| `database.psql`                       | `docker compose exec`                               | `db psql`, the `e2e` step: a bash command that takes psql's arguments after it                                                    |
| `server.project`                      | the one web-SDK `.csproj` (below)                   | `server`: the folder of the server's `.csproj`                                                                                    |
| `server.logFile`                      | `.artifacts/logs/server.jsonl`                      | `server` writes it, `logs` reads the newest `*.jsonl` of its folder                                                               |
| `smoke.checks`                        | `/healthz` (`^ok`), `/api/health` (`"status":"ok"`) | `smoke`: a list of `{path, expect, hint}`; `expect` is a regular expression matched on some line                                  |
| `directories.web`                     | none                                                | `tmux`: the web app's folder, where `pnpm dev` runs                                                                               |

Without `server.project`, `server` and `tmux` run the one project whose `.csproj` is on `Sdk="Microsoft.NET.Sdk.Web"`, looked for
in `directories.dotnet` or, without it, in the whole repository (not in `node_modules`, `bin`, `obj` or hidden folders). With none or
several of them, they stop and name the candidates and `server.project`.

The port offset reproduces what the repositories did by hand: alfusion is `portOffset: 60` (6360, 3360, 5593, 8250), suwagcms 30
and suwageval -70.

## What each command does

- `db` runs `docker compose -f <file> --profile <profile>` on the database service (and `extraServices`). With
  `database.up` and `database.psql`, `up` and `psql` run those commands instead (the output of `up` goes to stderr, the address
  to stdout) and `down`, `reset`, `logs` and `status` refuse, naming them: they are the repository's own. `up` starts it,
  waits until it is healthy and prints `postgresql://user:password@localhost:<port>/<database>`. `down` stops it, the data stays
  in the volume. `reset` removes the containers and the volume after asking (`--yes` does not ask). `psql` runs psql as the owner
  in the app's database, with a terminal only when there is one, so `suwgate dev db psql -c "select 1"` works in scripts.
- `logs` answers "why did it fail?": the last 20 warnings and errors of the newest JSON log, one line each (time, level, category,
  trace, message, and the first line of an exception). `--all` shows every level, `--trace <id>` every line of one request (a bare
  32-digit traceId or the W3C `traceparent` form), `--compose` reads `docker compose logs` of the server service.
- `smoke` makes read-only requests through the stack's web and reports what failed and what to look at.
- `server` loads `.env` of the repository root, runs `dotnet watch` on the server project and tees the output to the log file.
  An edit that hot reload cannot apply restarts the app without asking; when `dotnet watch` exits it starts again after a pause that
  doubles from 2 to 60 seconds while it keeps failing within a minute. Ctrl+C stops it.
- `tmux` builds the session `<name>-dev`: a shell on the left, the server (after `db up`) and the web app on the right, panes
  titled `server: (<port>)` and `web: (<port>)`. It reuses a running session, `--restart` kills it first (refused from inside
  it), `stop` kills it. In a tmux pane the client is switched, not nested; whether a terminal is a pane is decided by its tty,
  not by `TMUX` alone, because an editor started from a pane hands `TMUX` down to its terminals. `TMUX_DEV_NO_ATTACH=1` builds
  the session and stops.
- `checkout-env` prints `export` lines for `eval`. The main checkout and CI keep the plain names (`<database>_e2e`, the e2e
  ports); a linked git worktree gets its own e2e and test databases and its own e2e port pair, from a hash of the repository's
  git directory and the worktree's directory name, so worktrees with the same name in two repositories never share a port or a
  database, and one worktree gets the same ones on every run. A value already in the environment wins. The builds also stop leaving MSBuild workers behind.

## Moving a repository to it

The template stays as it is until its own migration. Then:

- `scripts/.internal/db.sh`, `logs.sh`, `smoke.sh`, `server.sh`, `tmux-dev.sh` and `checkout-env.sh` are deleted;
  `Myapp.Gate/scripts/check.sh` and `e2e.sh` use `eval "$(suwgate dev checkout-env)"` instead of `source checkout-env.sh`, and
  `suwgate dev db up` instead of `db.sh up`.
- `tmux-dev.just` becomes two one-line recipes, `@suwgate dev tmux start {{ args }}` and `@suwgate dev tmux stop`; in the
  `justfile`, `logs` becomes `@suwgate dev logs "$@"` (keep `[positional-arguments]`), and `just db` and `just smoke`, where a
  repository has them, `@suwgate dev db {{ args }}` and `@suwgate dev smoke {{ args }}`.
- `suwgate.yml` gets the `dev` section with the values the scripts held (`name`, `portOffset`, `database`, `extraServices`).
- The criteria of the template (`Tools/LogsScriptTests.cs`) go away with the script: the logic of `logs` is tested in suwgate
  (`src/dev/logs.test.ts`).

## Not in it, on purpose

- Driving a database started with a plain `docker run` (suwagcms, suwageval, suwchatbot) beyond `up` and `psql`, and its check
  that the container runs the pinned image: the repository names its own script in `database.up` and `database.psql` and keeps
  the rest there, or adds a database service to its compose file, where compose recreates a container whose image changed.
- The extra panes of suwageval (the example agent, a spare shell) and its `SUWAGEVAL_AGENT_DIR`: they are specific to that
  repository, which keeps them in its own script or recipe.
- `init-project`, `e2e.sh`, `slow-tests.sh`: `init-project` stays in the template, the other two are other work packages.
