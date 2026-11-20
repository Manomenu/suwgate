import type { Guard } from "../../gate/contract.ts";
import { centralPackagesFile, msbuildFiles, packagesIn } from "./msbuild.ts";

export const unusedNugetVersions: Guard = {
    id: "unused-nuget-versions",
    description: "Every package version of Directory.Packages.props is referenced by a project",
    profiles: ["dotnet"],
    check(context) {
        const central = centralPackagesFile(context);
        if (!context.files.includes(central)) {
            return [];
        }
        const centralText = context.read(central);
        const referenced = new Set(
            msbuildFiles(context).flatMap((file) =>
                packagesIn(file === central ? centralText : context.read(file), ["PackageReference", "GlobalPackageReference"]),
            ),
        );
        return [...new Set(packagesIn(centralText, ["PackageVersion"]))]
            .filter((name) => !referenced.has(name))
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({
                target: name,
                message: `no project references it: remove its PackageVersion from ${central}; a package arrives with the first code that uses it`,
            }));
    },
};
