# First release

Steps for the owner, once, in this order: A publishes the CLI to npmjs.com, B publishes the .NET packages to nuget.org. After this,
CI publishes every release and no step below is repeated, except the version bump and the tag of B.

Nothing here is done by an agent: it needs the owner's npm and NuGet accounts.

## A) npm: `@maniumek/suwgate`

The first publish is manual, because npm lets you attach a trusted publisher only to a package that already exists.

1. Merge the "Version Packages" pull request on GitHub. Then `package.json` on `master` says `0.1.0`:
   `git switch master && git pull && node -p "require('./package.json').version"` prints `0.1.0`. If the pull request does not exist, `master`
   has no changeset yet: stop and ask for one.
2. Log in as `maniumek`: `npm login` (browser flow, with 2FA). Check with `npm whoami`.
3. From a clean, up to date `master`: `pnpm install --frozen-lockfile && pnpm publish --access public`. The scoped package needs
   `--access public`, otherwise npm refuses it. Check on `https://www.npmjs.com/package/@maniumek/suwgate` that `0.1.0` is there.
4. On the package's page on npmjs.com: Settings, "Trusted Publisher", GitHub Actions, and fill in:
    - Organization or user: `Manomenu`
    - Repository: `suwgate`
    - Workflow filename: `ci.yml`
    - Environment: leave empty
    - tick "npm publish"

    Save.

5. Same Settings page, "Publishing access": choose "Require two-factor authentication and disallow tokens". From now on only
   trusted publishing (the `publish` job of `ci.yml`) and a person with 2FA can publish.

Afterwards a merged "Version Packages" pull request publishes by itself, with provenance.

## B) NuGet: `Suwgate.Architecture` and `Suwgate.Database`

1. Create an account on `https://www.nuget.org` ("Sign in", "Microsoft account" or GitHub). Confirm the email address. Open the profile
   menu and note the profile name (the user name in the address `nuget.org/profiles/<name>`); it is not the email address.
2. Add a trusted publishing policy: click your user name, "Trusted Publishing", add a new policy:
    - Policy owner: your user (not an organization)
    - Repository Owner: `Manomenu`
    - Repository: `suwgate`
    - Workflow File: `ci.yml` (the file name only, no folder)
    - Environment: `nuget-org`
    - Scopes: allow publishing new packages and new versions, package pattern `Suwgate.*` (the packages do not exist yet, so a scope
      that only covers existing packages would refuse the first push)

    Save. For a private repository the policy is active for 7 days until the first successful publish makes it permanent; suwgate is
    public.

3. In the repository on GitHub: Settings, "Secrets and variables", Actions, tab "Variables", "New repository variable": name
   `NUGET_USER`, value the profile name from step 1. It is a variable, not a secret: the name is not confidential. The `publish-nuget` job does not run
   without it.
4. Push the release tag on the commit of `master` whose `Directory.Build.props` says `<Version>0.1.0</Version>` (it does today):
   `git switch master && git pull && git tag nuget-v0.1.0 && git push origin nuget-v0.1.0`. The prefix `nuget-v` is required; the tag
   `v0.1.0` of the CLI does not publish anything to NuGet. The first run may wait for approval if the environment `nuget-org` has required
   reviewers; the environment is created by the first run, add reviewers in Settings, "Environments" if wanted.
5. After the run:
    - the run `ci` of the tag is green, the jobs `gate`, `pack-nuget` and `publish-nuget` all ran, and `publish-nuget` printed
      "Your package was pushed" twice (the symbols packages `.snupkg` are pushed with them);
    - `https://www.nuget.org/packages/Suwgate.Architecture/0.1.0` and `https://www.nuget.org/packages/Suwgate.Database/0.1.0` open (a
      new package is "validating" for a few minutes first, and nuget.org emails you the result);
    - both pages show the README, the MIT license and the repository link;
    - in a scratch folder `dotnet new classlib && dotnet add package Suwgate.Architecture --version 0.1.0` restores;
    - nuget.org, Trusted Publishing: the policy is active.

    A failure of the version check means `Directory.Build.props` and the tag disagree: a NuGet version is never reused, so delete
    nothing on nuget.org; fix the props, and push a new tag with the next version.

Later releases: change `Version` in `Directory.Build.props`, merge to `master`, tag `nuget-v<that version>`, push the tag.

## suwbackkit

suwbackkit publishes the same way and needs the same NuGet steps: the policy with Repository `suwbackkit`, Workflow File `ci.yml`,
Environment `nuget-org`, the variable `NUGET_USER` in that repository, and the tag `v0.1.0` (its tags are plain `v*`, MinVer reads the
version from them). An account made for suwgate is reused: add a second policy on it, or widen the scope pattern.
