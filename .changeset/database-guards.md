---
"@maniumek/suwgate": minor
---

Two guards of the profile `database`: `migrations-unchanged` (a migration script that exists on master is not changed or deleted;
the setting `folders` replaces the default `Database/Migrations/up/`) and `connection-host` (no connection string says `Host=` followed by the host's name; write `Host=127.0.0.1`).
