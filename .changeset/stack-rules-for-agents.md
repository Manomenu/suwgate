---
"@maniumek/suwgate": minor
---

The shared rules for agents: suwgate ships `AGENTS.shared.md`, `suwgate agents-shared` writes it into the repository root, and the new `agents-shared` guard fails while the copy differs from the shipped one or `AGENTS.md` lacks the line `Read @AGENTS.shared.md first: the rules every repository of the stack shares. This file adds this repository's own and wins where it says otherwise.` A repository must run `suwgate agents-shared`, add that line to `AGENTS.md`, and delete from `AGENTS.md` what the shared file now says.
