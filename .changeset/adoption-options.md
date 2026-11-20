---
"@maniumek/suwgate": minor
---

- `docs-paths` takes `skip`, globs of documents it does not read at all (`docs-paths: { skip: [docs/notes/**] }`).
- `app()` of `@maniumek/suwgate/eslint` takes `sharedImports`, the edges allowed between shared folders
  (`sharedImports: [["design", "api"]]`); every other import between shared folders still fails.
