---
"@maniumek/suwgate": minor
---

Add `suwgate dev api-types` and `suwgate dev slow-tests`. `api-types` regenerates the API contract and the web app's types with the same discovery the `api-contract` step uses, and the step now says "regenerate them (suwgate dev api-types)". `slow-tests` reports the slowest .NET tests. A repository can delete `scripts/.internal/api-types.sh` and `scripts/.internal/slow-tests.sh` and point its recipes at `suwgate dev api-types` and `suwgate dev slow-tests`; a repository that keeps its own `just api-types` recipe keeps working.
