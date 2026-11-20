---
"@maniumek/suwgate": minor
---

Three guards for the `dotnet` profile: `banned-nuget-packages` (no MediatR, AutoMapper, Mapster, Scrutor, Moq, NSubstitute,
FakeItEasy, FluentAssertions, Newtonsoft.Json or EF Core, more through `settings.banned-nuget-packages.packages`),
`unused-nuget-versions` (every version of `Directory.Packages.props` is referenced) and `appsettings-bound` (every section of
`appsettings*.json` is read by `BindConfiguration`, `GetSection` or `GetRequiredSection`).
