---
"@maniumek/suwgate": minor
---

The gate proves that a check ran, from what the tool reports, instead of trusting that a file or a line of text is there:

- `dotnet-test` sets `SUWGATE_EVIDENCE` to a fresh folder of the run and fails unless every .NET guard of the profiles ran
  (`SuwgateGuards.VerifyAll` of Suwgate.Architecture 0.2.0, or `Guards.Verify`), so a deleted or skipped guard test fails the gate.
  It also runs `dotnet test --zero-tests-policy strict --report-xunit-xml` and fails when no test ran.
- `guards.skip` in `suwgate.yml` turns one whole guard off with a reason: a repository guard, or a .NET guard. The CLI knows the
  .NET guard ids and validates the entries; `settings` take `database/migration-script-names: { directory }`.
- `unit-tests`, `stories` and `e2e` fail when Vitest or Playwright ran 0 tests (their JSON reports).
- `typecheck` reads `tsc --showConfig` of every tsconfig and fails when a strict option of the preset is off; `lint` reads
  `eslint --print-config` of a source file and fails unless `suwgate/no-comments` and `boundaries/dependencies` are errors.

What a repository must change: on the `dotnet` profile, reference Suwgate.Architecture 0.2.0 and replace the per-guard tests with
one `SuwgateGuards.VerifyAll` test (or keep `Guards.Verify` for every guard), skip the guards that do not apply in `guards.skip`
with a reason; give every test step at least one test that runs, or skip the step with a reason; a library's ESLint config needs
`boundaries/dependencies` at error for its `src/` files.
