namespace Suwgate.Tests.Architecture;

internal static class Samples
{
    internal interface ILonely
    {
        int Value { get; }
    }

    internal interface IPaired
    {
        int Value { get; }
    }

    internal sealed class OnlyOne : ILonely
    {
        public int Value => 1;
    }

    internal sealed class First : IPaired
    {
        public int Value => 1;
    }

    internal sealed class Second : IPaired
    {
        public int Value => 2;
    }
}
