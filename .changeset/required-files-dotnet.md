---
"@maniumek/suwgate": minor
---

`required-files` asks the `dotnet` profile for `Directory.Build.rsp` (`-nodeReuse:false`) and for exactly one `*.slnx` in its
directory. A repository without them adds them (`dotnet new sln --format slnx`, or `dotnet sln migrate` for an old `.sln`).
