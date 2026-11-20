---
"@maniumek/suwgate": patch
---

`dotnet-test` no longer loses an xUnit report at random in a repository with more than one test project. xUnit named each report
after the moment its test project started, so two projects that `dotnet test` started together could write the same file, one
overwriting the other, and `criteria-ran` and the count of tests run then took passing tests for tests that never ran. Each test
project now writes its own report, `<project>.<target framework>.xunit.xml`: the step passes `--report-xunit-xml-filename` to each
project through `TestingPlatformCommandLineArguments`, set by a targets file it hands to `dotnet test` as
`-p:CustomAfterMicrosoftCommonTargets`, so a repository that sets `CustomAfterMicrosoftCommonTargets` itself loses its value in
this step.
