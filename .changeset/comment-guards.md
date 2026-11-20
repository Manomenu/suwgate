---
"@maniumek/suwgate": minor
---

The comment guards: `comments-hash`, `comments-css`, `comments-json`, `comments-markup`, `comments-sql`, `comments-csharp`,
`comments-eslint` and `no-in-place-switches` refuse every comment but the tool directives of AGENTS.md, "No comments", and every
in-place switch (`@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `#pragma warning disable`). `@maniumek/suwgate/eslint` exports the
rule `no-comments` (as the plugin `suwgate`), `strict()` (the strict and stylistic type-checked sets, `suwgate/no-comments`, no
inline configuration) and `app()` (also the feature boundaries of `src/` and the browser-storage ban), so a repository drops its own
copy of the rule. A repository that switches over: extend `strict()` or `app({ features, shared, storage })` in `eslint.config.js`,
delete its local `no-comments` rule, its `eslint-disable` allowance and the comment tests of its own gate, and install the peer
dependencies it lints with (eslint, @eslint/js, typescript-eslint, eslint-plugin-boundaries, eslint-import-resolver-typescript).
