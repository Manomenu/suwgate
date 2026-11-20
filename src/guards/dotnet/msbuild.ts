import type { GuardContext } from "../../gate/contract.ts";

const MSBUILD_FILE = /\.(csproj|props|targets)$/;
const ARTIFACTS = /(^|\/)(bin|obj)\//;

export function dotnetFiles(context: GuardContext, pattern: RegExp): string[] {
    const directory = context.directories.dotnet;
    return context.files.filter(
        (file) => (directory === undefined || file.startsWith(`${directory}/`)) && pattern.test(file) && !ARTIFACTS.test(file),
    );
}

export function msbuildFiles(context: GuardContext): string[] {
    return dotnetFiles(context, MSBUILD_FILE);
}

export function centralPackagesFile(context: GuardContext): string {
    const directory = context.directories.dotnet;
    return directory === undefined ? "Directory.Packages.props" : `${directory}/Directory.Packages.props`;
}

export function packagesIn(text: string, elements: readonly string[]): string[] {
    const pattern = new RegExp(`<(?:${elements.join("|")})\\b[^>]*?\\bInclude\\s*=\\s*"([^"]+)"`, "g");
    return [...text.matchAll(pattern)].map((match) => match[1] ?? "").filter((name) => name !== "");
}
