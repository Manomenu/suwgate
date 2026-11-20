import path from "node:path";

import type { Finding, Guard, GuardContext } from "../../gate/contract.ts";
import { dotnetFiles } from "./msbuild.ts";

const PROJECT = /\.csproj$/;
const CSHARP = /\.cs$/;
const WEB_SDK = /<Project\b[^>]*\bSdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/;
const KIT_REFERENCE =
    /<(?:PackageReference\b[^>]*\bInclude\s*=\s*"Suwbackkit\.Server"|ProjectReference\b[^>]*\bInclude\s*=\s*"[^"]*Suwbackkit\.Server\.csproj")/;
const CALLS = [
    { method: "AddServerDefaults", pattern: /\.AddServerDefaults\s*(?:<[^>]*>)?\s*\(/, on: "the builder (builder.AddServerDefaults())" },
    { method: "MapServerDefaults", pattern: /\.MapServerDefaults\s*\(/, on: "the app (app.MapServerDefaults())" },
];

function findingsOf(context: GuardContext, project: string): Finding[] {
    const folder = path.posix.dirname(project);
    const sources = dotnetFiles(context, CSHARP)
        .filter((file) => folder === "." || file.startsWith(`${folder}/`))
        .map((file) => context.read(file));
    return CALLS.filter((call) => !sources.some((text) => call.pattern.test(text))).map((call) => ({
        target: project,
        message: `the server references Suwbackkit.Server but never calls ${call.method}: call it on ${call.on} where the server is built, so it gets the kit's logging, problem details, OpenAPI and the /health and /alive checks`,
    }));
}

export const suwbackkitWiring: Guard = {
    id: "suwbackkit-wiring",
    description:
        "A web server that references Suwbackkit.Server calls AddServerDefaults and MapServerDefaults, so the kit is wired, not only installed",
    profiles: ["dotnet"],
    check: (context) =>
        dotnetFiles(context, PROJECT)
            .filter((project) => {
                const text = context.read(project);
                return WEB_SDK.test(text) && KIT_REFERENCE.test(text);
            })
            .flatMap((project) => findingsOf(context, project)),
};
