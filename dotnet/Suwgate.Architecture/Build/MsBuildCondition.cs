using System.Globalization;
using System.Text.RegularExpressions;

namespace Suwgate.Architecture.Build;

internal sealed partial class MsBuildCondition
{
    private static readonly string[] Comparisons = ["==", "!=", "<=", ">=", "<", ">"];

    private readonly List<string> tokens;

    private readonly Func<string, string?> property;

    private int position;

    private MsBuildCondition(string condition, Func<string, string?> property)
    {
        tokens = [.. Token().Matches(condition).Select(match => match.Value)];
        if (Token().Replace(condition, "").Trim().Length > 0)
        {
            throw Unreadable(condition);
        }
        this.property = property;
    }

    public static bool Evaluate(string condition, Func<string, string?> property)
    {
        var parser = new MsBuildCondition(condition, property);
        var result = parser.Or();
        return parser.position == parser.tokens.Count ? result : throw Unreadable(condition);
    }

    private bool Or()
    {
        var result = And();
        while (Next("or"))
        {
            result = And() || result;
        }
        return result;
    }

    private bool And()
    {
        var result = Unary();
        while (Next("and"))
        {
            result = Unary() && result;
        }
        return result;
    }

    private bool Unary()
    {
        if (Next("!"))
        {
            return !Unary();
        }
        if (Next("("))
        {
            var inner = Or();
            return Next(")") ? inner : throw Unreadable(string.Concat(tokens));
        }
        var left = Operand();
        var comparison = Comparisons.FirstOrDefault(Next);
        if (comparison is null)
        {
            return bool.TryParse(left, out var value) ? value : throw Unreadable(left);
        }
        var right = Operand();
        return comparison switch
        {
            "==" => string.Equals(left, right, StringComparison.OrdinalIgnoreCase),
            "!=" => !string.Equals(left, right, StringComparison.OrdinalIgnoreCase),
            _ => Compare(comparison, Number(left), Number(right)),
        };
    }

    private string Operand()
    {
        if (position >= tokens.Count || Comparisons.Contains(tokens[position]) || tokens[position] is "(" or ")" or "!")
        {
            throw Unreadable(string.Concat(tokens));
        }
        var token = tokens[position++];
        if (position < tokens.Count && tokens[position] == "(")
        {
            throw Unreadable($"{token}(…)");
        }
        return Expand(token.StartsWith('\'') ? token[1..^1] : token);
    }

    private string Expand(string text)
    {
        if (text.Contains("@(", StringComparison.Ordinal) || text.Contains("%(", StringComparison.Ordinal))
        {
            throw Unreadable(text);
        }
        return Reference()
            .Replace(
                text,
                match =>
                    PropertyName().IsMatch(match.Groups[1].Value)
                        ? property(match.Groups[1].Value) ?? throw Unreadable(match.Value)
                        : throw Unreadable(match.Value)
            );
    }

    private bool Next(string token)
    {
        if (position < tokens.Count && string.Equals(tokens[position], token, StringComparison.OrdinalIgnoreCase))
        {
            position++;
            return true;
        }
        return false;
    }

    private static decimal Number(string text) =>
        decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var number) ? number : throw Unreadable(text);

    private static bool Compare(string comparison, decimal left, decimal right) =>
        comparison switch
        {
            "<" => left < right,
            ">" => left > right,
            "<=" => left <= right,
            _ => left >= right,
        };

    private static FormatException Unreadable(string part) => new($"cannot read {part}");

    [GeneratedRegex(@"'[^']*'|==|!=|<=|>=|<|>|!|\(|\)|(?:\$\([^)]*\)|[^\s'=!<>()])+")]
    private static partial Regex Token();

    [GeneratedRegex(@"\$\(([^)]*)\)")]
    private static partial Regex Reference();

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_\-]*$")]
    private static partial Regex PropertyName();
}
