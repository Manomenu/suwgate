---
"@maniumek/suwgate": patch
---

The `unit-tests` step runs only the Vitest project `unit` also when the config builds it with `unitTests()` of the preset
(it ran every project, the stories in Chromium among them). `suwgate hook guard-edit` protects `knip.config.ts` and
`prettier.config.js`, the files the knip and Prettier presets are extended in.
