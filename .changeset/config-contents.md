---
"@maniumek/suwgate": minor
---

New guard `config-contents`: the config files suwgate relies on must say what it needs (README, "What the config files must say"):
an exact `sdk.version`, a `sdk.rollForward` short of a major and `test.runner` `Microsoft.Testing.Platform` in `global.json`;
`max_line_length = 140` for C# and the MSBuild files in `.editorconfig`, and no `.csharpierrc*` (delete `.csharpierrc.json`: CSharpier
reads the width from `.editorconfig`, and a `.csharpierrc` would win over it); `ManagePackageVersionsCentrally` in
`Directory.Packages.props`; the suwgate presets in the tsconfig, ESLint, Prettier, knip, Vitest and Playwright configs; an exact
`@maniumek/suwgate` version; no `minimumReleaseAge: 0`; the schema in `yaml.schemas`; and a CI job that calls
`Manomenu/suwgate/.github/workflows/gate.yml` pinned by its full commit sha. A repository fixes each finding as its message says, or
adds an exception with the reason.
