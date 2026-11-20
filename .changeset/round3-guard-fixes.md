---
"@maniumek/suwgate": patch
---

Fixes found while moving eight repositories onto suwgate:

- `comments-hash` reads no comment inside a YAML block scalar (`|`, `>`), and takes just recipe parameters with defaults
  (`logs service="":`) and `mod <name> '<path>'` as the line a recipe comment describes.
- `no-raw-colors` leaves HTML entities (`&#106;`) alone.
- `just-modules` accepts `mod <name> '<path>'`, a file or a folder with `mod.just`, `justfile` or `.justfile`.
- `appsettings-bound` reads `BindConfiguration(XOptions.Section)` and `GetSection(...)` through a `const string`.
- `image-pins` leaves a Helm template image (`{{ … }}`) to the deployment.
- `scripts-called` counts only the commands of `suwgate.yml` (`steps.add` run, `steps.configure`, `env`, `dev`), not its
  exceptions and reasons, and counts a Claude Code plugin's `hooks/hooks.json` as a caller.
- The knip preset ignores `prettier` as a step's tool and no longer earns "Remove from ignore" for the generated API types.
- `app()` of the ESLint preset gives the import resolver the first project only, so it no longer prints "Multiple projects found".
