---
"@maniumek/suwgate": minor
---

`suwgate dev sibling`: the Docker images of a sibling repository checked out next to this one, rebuilt from its checkout whenever
they are not what it holds now (an image is missing, it was built from another commit, it was rebuilt or pulled since, or the
checkout has uncommitted changes), so a repository never runs an old image of a sibling again.

- `suwgate dev sibling <name> image` makes the images current; `up` also starts them with the repository's compose file and waits
  until the health address answers; `rebuild` builds whatever the state; `down` stops them, the data stays; `status` says what
  runs and whether the images are current; `suwgate dev sibling` lists the siblings. The state lives in
  `.artifacts/dev/siblings/<name>.json`.
- Configure a sibling in `suwgate.yml` under `dev.siblings.<name>`: `images` (required), and `checkout` (default `../<name>`),
  `build` (default `docker compose build`, run in the checkout), `compose` (a compose file of this repository) and `health`.
- What a repository can delete: its own scripts that rebuild or start a sibling's images (in suwchatbot the image part of
  `scripts/.internal/suwagcms.sh`, its `build-labels.yaml` and the `up`, `rebuild`, `down` and `status` recipes, which become
  `@suwgate dev sibling suwagcms <command>`), and the plain image runs of a sibling in the others, which now get rebuilt too.
