---
"@maniumek/suwgate": patch
---

`dev checkout-env` hashes the repository's git directory together with the worktree's directory name, so worktrees with the
same name in two repositories (say `suwgate-0.5` in the template, suwstockdrill and alfusion) no longer get the same e2e
ports and test database names and collide when they run at the same time; one worktree still gets the same values on every
run. Existing worktrees get new ports and database names once: their old `<database>_test_<suffix>` and
`<database>_e2e_<suffix>` databases are no longer used and can be dropped.

`test-timing` lets through the `timeout` option of a Vitest wait for an event (`vi.waitFor`, `vi.waitUntil`, `expect.poll`,
Testing Library's `waitFor`, `findBy*` and `findAllBy*`): like `CancelAfter` and `WaitAsync(TimeSpan)` in C#, it is a ceiling
against a hang, not a speed promise. A test's own limit (`timeout:` in the options of `it`, `test` or `describe`,
`test.setTimeout`) is still a finding.
