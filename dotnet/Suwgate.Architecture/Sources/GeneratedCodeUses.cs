using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.CompilerServices;

namespace Suwgate.Architecture.Sources;

internal static class GeneratedCodeUses
{
    private const BindingFlags AllMembers =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

    private static readonly Dictionary<short, OpCode> OpCodesByValue = typeof(OpCodes)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Select(field => field.GetValue(null))
        .OfType<OpCode>()
        .ToDictionary(code => code.Value);

    private static readonly Dictionary<OperandType, int> OperandSizes = new()
    {
        [OperandType.InlineNone] = 0,
        [OperandType.ShortInlineBrTarget] = 1,
        [OperandType.ShortInlineI] = 1,
        [OperandType.ShortInlineVar] = 1,
        [OperandType.InlineVar] = 2,
        [OperandType.InlineI8] = 8,
        [OperandType.InlineR] = 8,
    };

    private static readonly OperandType[] Tokens =
    [
        OperandType.InlineMethod,
        OperandType.InlineField,
        OperandType.InlineType,
        OperandType.InlineTok,
    ];

    public static IReadOnlyList<(string Owner, string Used)> Of(IEnumerable<Assembly> assemblies) =>
        [
            .. assemblies
                .SelectMany(assembly => assembly.DefinedTypes)
                .Where(Generated)
                .SelectMany(type =>
                    type.GetMethods(AllMembers)
                        .Cast<MethodBase>()
                        .Concat(type.GetConstructors(AllMembers))
                        .SelectMany(method => UsedTypes(type, method))
                        .Select(used => (Owner: SolutionTypes.NameOf(Owner(type)), Used: SolutionTypes.NameOf(used)))
                )
                .Distinct(),
        ];

    private static bool Generated(Type type) =>
        SolutionTypes.NameOf(type).Contains('<', StringComparison.Ordinal)
        || type.IsDefined(typeof(CompilerGeneratedAttribute), inherit: false);

    private static Type Owner(Type type)
    {
        var owner = type;
        while (owner.DeclaringType is { } declaring && SolutionTypes.NameOf(owner).Contains('<', StringComparison.Ordinal))
        {
            owner = declaring;
        }
        return owner;
    }

    private static IEnumerable<Type> UsedTypes(Type type, MethodBase method)
    {
        var il = method.GetMethodBody()?.GetILAsByteArray() ?? [];
        var position = 0;
        while (position < il.Length)
        {
            var value = il[position] == 0xFE && position + 1 < il.Length ? unchecked((short)(0xFE00 | il[++position])) : il[position];
            position++;
            if (!OpCodesByValue.TryGetValue(value, out var code))
            {
                yield break;
            }
            if (
                Tokens.Contains(code.OperandType)
                && position + 4 <= il.Length
                && Resolve(type, method, BitConverter.ToInt32(il, position)) is { } used
            )
            {
                yield return used;
            }
            position += OperandSize(code.OperandType, il, position);
        }
    }

    private static Type? Resolve(Type type, MethodBase method, int token)
    {
        try
        {
            var member = type.Module.ResolveMember(
                token,
                type.IsGenericType ? type.GetGenericArguments() : null,
                method.IsGenericMethod ? method.GetGenericArguments() : null
            );
            var used = member as Type ?? member?.DeclaringType;
            while (used is not null && (used.IsArray || used.IsByRef || used.IsPointer))
            {
                used = used.GetElementType();
            }
            return used is { IsGenericType: true, IsGenericTypeDefinition: false } ? used.GetGenericTypeDefinition() : used;
        }
        catch (Exception exception)
            when (exception
                    is ArgumentException
                        or BadImageFormatException
                        or TypeLoadException
                        or FileNotFoundException
                        or MissingMemberException
            )
        {
            return null;
        }
    }

    private static int OperandSize(OperandType operand, byte[] il, int position)
    {
        if (operand == OperandType.InlineSwitch)
        {
            return position + 4 <= il.Length ? 4 + (4 * BitConverter.ToInt32(il, position)) : il.Length;
        }
        return OperandSizes.TryGetValue(operand, out var size) ? size : 4;
    }
}
