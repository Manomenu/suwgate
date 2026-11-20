---
"@maniumek/suwgate": minor
---

`suwgate dev db|logs|smoke|server|tmux|checkout-env`: the template's dev scripts as commands, configured by a new `dev` section of
`suwgate.yml` (the app's `name`, `portOffset` or `ports`, the compose file and services, the database, the server project, the smoke
checks); paths come from `directories`. See docs/dev.md. A repository that adds `dev:` to `suwgate.yml` needs nothing else; the
section is new, so no existing `suwgate.yml` changes.
