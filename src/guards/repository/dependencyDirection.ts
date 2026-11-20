import path from "node:path";

import type { Finding, Guard, GuardContext } from "../../gate/contract.ts";
import { npmDependencies, RUNTIME_GROUPS } from "./packageManifests.ts";
import { baseName, lineAt, stringList, wildcard } from "./text.ts";

const NUGET_REFERENCE = /<(PackageReference|PackageVersion|ProjectReference)\b[^>]*?\bInclude="([^"]+)"/g;
const LOCAL_PATH = /^(link|file|portal):/;

interface Settings {
    applications?: string[];
    forbidden?: string[];
}

interface Reference {
    where: string;
    line: number;
    name: string;
    runtime: boolean;
    localPath: string | null;
}

function isShippedProject(file: string, text: string): boolean {
    const project = baseName(file).replace(/\.csproj$/, "");
    return !/\.Tests?$/.test(project) && !/<IsTestProject>\s*true\s*</i.test(text) && !/<IsPackable>\s*false\s*</i.test(text);
}

function nugetReferences(context: GuardContext): Reference[] {
    return context.files
        .filter((file) => /\.(csproj|props|targets)$/.test(file))
        .flatMap((file) => {
            const text = context.read(file);
            const runtime = !file.endsWith(".csproj") || isShippedProject(file, text);
            return [...text.matchAll(NUGET_REFERENCE)].map((match) => {
                const include = (match[2] ?? "").replaceAll("\\", "/");
                const isProject = match[1] === "ProjectReference";
                const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), include));
                return {
                    where: file,
                    line: lineAt(text, match.index),
                    name: isProject ? baseName(include).replace(/\.\w+proj$/, "") : include,
                    runtime: runtime && match[1] !== "PackageVersion",
                    localPath: isProject && resolved.startsWith("../") ? include : null,
                };
            });
        });
}

function npmReferences(context: GuardContext): Reference[] {
    return npmDependencies(context).map((dependency) => ({
        where: dependency.manifest,
        line: dependency.line,
        name: dependency.name,
        runtime: !dependency.privateManifest && (RUNTIME_GROUPS as readonly string[]).includes(dependency.group),
        localPath: LOCAL_PATH.test(dependency.version) ? dependency.version : null,
    }));
}

function findingOf(reference: Reference, settings: Settings, isLibrary: boolean): Finding | null {
    const { where, line, name } = reference;
    const matches = (patterns: readonly string[] | undefined) => (patterns ?? []).some((pattern) => wildcard(pattern).test(name));
    if (matches(settings.forbidden)) {
        return {
            target: name,
            line,
            message: `${where} depends on it, and this repository never does (settings.dependency-direction.forbidden in suwgate.yml): remove the dependency; what both need belongs in a package below them both`,
        };
    }
    if (!isLibrary || !reference.runtime) return null;
    if (matches(settings.applications)) {
        return {
            target: name,
            line,
            message: `${where} depends on it at runtime, and it is an application (settings.dependency-direction.applications): a library never depends on an application; move what both need into the library and let the application depend on it`,
        };
    }
    if (reference.localPath !== null) {
        return {
            target: name,
            line,
            message: `${where} takes it from ${reference.localPath}, a path outside the published package (an application or unpublished code): depend on a published version, or move the code into this library`,
        };
    }
    return null;
}

export const dependencyDirection: Guard = {
    id: "dependency-direction",
    description:
        "Dependencies point one way: a library never depends at runtime on an application (named in settings, or taken from a local path), and no repository depends on a package its settings forbid",
    profiles: "every",
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            applications: { ...stringList, description: "npm or NuGet packages that are applications (* matches anything), e.g. Myapp.*." },
            forbidden: {
                ...stringList,
                description: "Packages this repository never depends on, not even to build or test (* matches anything).",
            },
        },
    },
    check(context) {
        const settings = (context.settings ?? {}) as Settings;
        const isLibrary = context.profiles.includes("library");
        return [...npmReferences(context), ...nugetReferences(context)].flatMap(
            (reference) => findingOf(reference, settings, isLibrary) ?? [],
        );
    },
};
