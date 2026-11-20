---
"@maniumek/suwgate": minor
---

The first suwgate CLI: `suwgate check [--quick] [--verbose]` reads and validates `suwgate.yml` (profiles, directories, steps to add
or skip, exceptions from the guards, each with its reason), runs the steps of the profiles `web`, `library`, `dotnet` and
`database` in parallel with the repository guards, and reports PASS or FAIL with times and the number of exceptions.
`suwgate hook guard-edit` and `suwgate hook stop` are the Claude Code hooks. The first guard is `required-files`.
