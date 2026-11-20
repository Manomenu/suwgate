---
"@maniumek/suwgate": patch
---

`suwgate dev logs` shows the trace of an ASP.NET Core log line again: the JSON console formatter writes `TraceId` in `Scopes`, not at the
top of the line, so no line of a real server showed `trace=`. Nothing changes for a repository.
