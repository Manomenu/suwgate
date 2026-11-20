---
"@maniumek/suwgate": patch
---

`quick.limitSeconds` in `suwgate.yml` sets the budget of `suwgate check --quick` for the repository (default 20 seconds);
`SUWGATE_QUICK_LIMIT` on a machine still overrides it.
