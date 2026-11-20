---
"@maniumek/suwgate": minor
---

- `criteria-ran` (every repository, after the test steps): an acceptance criterion of a living spec that a test names must have
  a test naming it that ran and passed in this gate run, by the reports of xUnit (`--report-xunit-xml`), Vitest and Playwright
  (JSON). `visual` and `consumer-app` now write Playwright's JSON report as well, and fail when 0 tests ran.
- `suwbackkit-wiring` (dotnet): a web server that references `Suwbackkit.Server` calls `AddServerDefaults` and `MapServerDefaults`.
- `suwfrontkit-wiring` (web, library): an app that depends on `@maniumek/suwfrontkit` loads `@maniumek/suwfrontkit/theme.css` from
  its main module or a stylesheet that module imports.

What a repository must change: un-skip, or make pass, every test that names a criterion; a skipped test step leaves its criteria
out of the check. Wire the kits where the new guards say so.
