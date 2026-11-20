---
"@maniumek/suwgate": minor
---

The steps of the profiles replace the check scripts of the template and of suwfrontkit: `pnpm-install`, `typecheck` over every
`tsconfig*.json` but the build one, `unit-tests` of the Vitest project `unit`, `stories`, `consumer-app`, `visual`, `e2e`,
`database-up`, `compose`, `criteria` (pinned `vdoc.py`, default kinds of guardrail per profile, more in a root `criteria.json`),
and the contract steps `api-contract`, `api-version` and `contract-pins`, which pass when a repository has no `contract/openapi.json`.
`dotnet-test --quick` runs only the test projects of the .NET guards. `attw` leaves out CSS and JSON entry points and runs after
`publint`, so the two never pack at once. The new guard `criteria-kinds` asks for a docs row of each kind `criteria.json` adds.
Presets an application extends in one line: `@maniumek/suwgate/prettier`, `/tsconfig/strict`, `/tsconfig/browser`, `/tsconfig/node`,
`/knip`, `/vitest` and `/playwright`. A step's `run` may return `{ skip: reason }`, and a run with nothing to check passes
before its tools are looked for. What a repository changes: its `criteria.json` moves to the root and keeps only its own kinds;
its scripts check.sh, criteria.sh, api-types.sh --check, api-diff.sh, contracts.sh, package.sh and visual.sh leave the gate.
