---
"@maniumek/suwgate": minor
---

The `e2e` step works for a real app: with a `dev` section in `suwgate.yml` it applies `suwgate dev checkout-env`, starts the
database (`suwgate dev db up`), drops and creates the checkout's empty `E2E_DATABASE`, then runs Playwright, whose `webServer`
starts and stops the server and the web app. A repository deletes its own fresh-database step, its `skip: e2e` and its
`scripts/.internal/e2e.sh`.
