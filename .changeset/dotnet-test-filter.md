---
"@maniumek/suwgate": patch
---

`suwgate step dotnet-test -- --filter-class "*Notes*"` no longer fails in a repository with more than one test project: with
arguments, a test project the filter misses no longer fails the step (`--ignore-exit-code 8` for each test project), and the step
still fails when no test of the whole run ran, by xUnit's reports. Without arguments the step stays strict for each test project.
