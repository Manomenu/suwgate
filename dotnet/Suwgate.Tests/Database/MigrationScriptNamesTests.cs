using Suwgate.Architecture.Verification;
using Suwgate.Database.Migrations;

namespace Suwgate.Tests.Database;

public sealed class MigrationScriptNamesTests : IDisposable
{
    private readonly DirectoryInfo up = Directory.CreateTempSubdirectory("suwgate-migrations-");

    public void Dispose() => up.Delete(recursive: true);

    private List<Finding> FindingsFor(params string[] names)
    {
        foreach (var name in names)
        {
            File.WriteAllText(Path.Combine(up.FullName, name), "select 1;");
        }
        return [.. new MigrationScriptNames(up.FullName).Check()];
    }

    [Fact]
    public void Numbered_snake_case_scripts_pass() => Assert.Empty(FindingsFor("0001_create_notes.sql", "0002_add_index.sql", ".gitkeep"));

    [Theory]
    [InlineData("1_create.sql")]
    [InlineData("0001-create-notes.sql")]
    [InlineData("0001_CreateNotes.sql")]
    [InlineData("0001_create_notes.txt")]
    public void A_misnamed_script_is_found_with_the_fix(string name)
    {
        var finding = Assert.Single(FindingsFor(name));

        Assert.Equal(new Finding(name, "name it NNNN_what_it_does.sql: four digits, then lower snake case"), finding);
    }

    [Fact]
    public void A_number_used_twice_is_found_on_the_later_script()
    {
        var finding = Assert.Single(FindingsFor("0001_create_notes.sql", "0001_create_tags.sql"));

        Assert.Equal("0001_create_tags.sql", finding.Target);
        Assert.Contains("taken by 0001_create_notes.sql", finding.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_missing_folder_is_found_with_the_fix()
    {
        var missing = Path.Combine(up.FullName, "nowhere");

        var finding = Assert.Single(new MigrationScriptNames(missing).Check());

        Assert.Equal(missing, finding.Target);
        Assert.Contains("pass the folder", finding.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void An_empty_folder_passes() => Assert.Empty(FindingsFor());
}
