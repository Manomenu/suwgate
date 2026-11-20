using Suwgate.Architecture.Code;
using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;
using Suwgate.Database.Migrations;

namespace Suwgate.Tests.Architecture;

public sealed class SuwgateOwnCodeTests
{
    private static readonly System.Reflection.Assembly[] Packages = [typeof(IGuard).Assembly, typeof(MigrationScriptNames).Assembly];

    private static readonly Lazy<RepositoryFiles> Repository = new(RepositoryFiles.Find);

    [Fact]
    public void Its_type_names_are_neither_vague_nor_shared() =>
        Assert.All(new IGuard[] { ForbiddenTypeNames.Of(Packages), UniqueTypeNames.Of(Packages) }, Guards.Verify);

    [Fact]
    public void Nothing_of_it_is_obsolete_or_unused() =>
        Assert.All(new IGuard[] { new NothingObsolete(Packages), new NoUnusedTypes(Packages, []) }, Guards.Verify);

    [Fact]
    public void Its_sources_hold_one_type_per_file_and_no_escape_hatch() =>
        Assert.All(
            new IGuard[] { new OneTypePerFile(Repository.Value.CSharpSources()), new NoEscapeHatches(Repository.Value.CSharpSources()) },
            Guards.Verify
        );
}
