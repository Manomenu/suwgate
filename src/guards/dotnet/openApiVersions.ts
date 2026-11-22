import type { Guard } from "../../gate/contract.ts";
import { centralPackagesFile } from "./msbuild.ts";

const TOOL = "Microsoft.Extensions.ApiDescription.Server";
const LIBRARY = "Microsoft.AspNetCore.OpenApi";

export function centralVersion(text: string, name: string): string | undefined {
    for (const match of text.matchAll(/<PackageVersion\b[^>]*>/g)) {
        const element = match[0];
        if (!new RegExp(`\\bInclude\\s*=\\s*"${name.replaceAll(".", "\\.")}"`).test(element)) continue;
        return /\bVersion\s*=\s*"([^"]+)"/.exec(element)?.[1];
    }
    return undefined;
}

export const openApiVersions: Guard = {
    id: "openapi-versions",
    description: `${TOOL}, which writes the OpenAPI contract at build, is pinned in Directory.Packages.props to the same version as ${LIBRARY}, whose OpenAPI library it loads`,
    profiles: ["dotnet"],
    check(context) {
        const file = centralPackagesFile(context);
        if (!context.files.includes(file)) return [];
        const text = context.read(file);
        const tool = centralVersion(text, TOOL);
        if (tool === undefined) return [];
        const library = centralVersion(text, LIBRARY);
        if (library === tool) return [];
        const pin = `<PackageVersion Include="${LIBRARY}" Version="${tool}" />`;
        return [
            {
                target: file,
                message:
                    library === undefined
                        ? `${TOOL} ${tool} loads the server's ${LIBRARY}, which only comes in through a package (Suwbackkit.Server) and can be another release, so the build of the contract fails with a Microsoft.OpenApi version mismatch: pin it beside the tool, ${pin}, and reference it from the server's project (<PackageReference Include="${LIBRARY}" />, which unused-nuget-versions asks for), so an update moves both`
                        : `${TOOL} is ${tool} but ${LIBRARY} is ${library}: the tool loads the server's OpenAPI library and fails on a Microsoft.OpenApi version mismatch, so give both the same version`,
            },
        ];
    },
};
