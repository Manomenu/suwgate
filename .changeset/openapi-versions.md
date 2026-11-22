---
"@maniumek/suwgate": minor
---

New guard `openapi-versions` (profile `dotnet`): when `Directory.Packages.props` pins `Microsoft.Extensions.ApiDescription.Server`, it pins `Microsoft.AspNetCore.OpenApi` at the same version. The tool loads the server's OpenAPI library to write the contract at build, and fails on a `Microsoft.OpenApi` mismatch when the library comes in through a package (Suwbackkit.Server) at another release. A repository adds `<PackageVersion Include="Microsoft.AspNetCore.OpenApi" Version="<the tool's version>" />` beside the tool; transitive pinning makes it win, and an update moves both.
