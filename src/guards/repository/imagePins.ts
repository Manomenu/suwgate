import type { Finding, Guard, GuardContext } from "../../gate/contract.ts";
import { baseName, isRecord, lineAt, parseJson } from "./text.ts";

interface ImageReference {
    file: string;
    line: number;
    image: string;
}

const FROM = /^[ \t]*FROM[ \t]+(?:--\S+[ \t]+)*(\S+)(?:[ \t]+AS[ \t]+(\S+))?/gim;
const YAML_IMAGE = /^[ \t]*(?:-[ \t]*)?image:[ \t]*["']?([^"'\s#]+)/gm;
const SHELL_IMAGE = /(?:^|\s)IMAGE=["']?([^"'\s]+)/gm;
const PLAYWRIGHT_IMAGE = /^mcr\.microsoft\.com\/playwright:v([\d.]+)-/;

function isDockerfile(name: string): boolean {
    return /^Dockerfile(\.[\w-]+)?$|\.Dockerfile$/.test(name);
}

function references(file: string, text: string): ImageReference[] {
    const found = (pattern: RegExp) =>
        [...text.matchAll(pattern)].map((match) => ({ file, line: lineAt(text, match.index), image: match[1] ?? "" }));
    const name = baseName(file);
    if (isDockerfile(name)) {
        const stages = new Set([...text.matchAll(FROM)].flatMap((match) => (match[2] === undefined ? [] : [match[2].toLowerCase()])));
        return found(FROM).filter((reference) => reference.image !== "scratch" && !stages.has(reference.image.toLowerCase()));
    }
    if (/\.ya?ml$/.test(name)) return name === "pnpm-lock.yaml" ? [] : found(YAML_IMAGE);
    return name.endsWith(".sh") ? found(SHELL_IMAGE) : [];
}

export function isPinned(image: string): boolean {
    if (image.includes("@sha256:")) return true;
    const tag = image.split("/").at(-1)?.split(":")[1];
    return tag !== undefined && tag !== "" && tag !== "latest";
}

function installedPlaywright(context: GuardContext): string[] {
    return context.files
        .filter((file) => baseName(file) === "package.json")
        .flatMap((file) => {
            const manifest = parseJson(context.read(file));
            if (!isRecord(manifest)) return [];
            return ["dependencies", "devDependencies"].flatMap((group) => {
                const dependencies = manifest[group];
                const version = isRecord(dependencies) ? dependencies["@playwright/test"] : undefined;
                return typeof version === "string" ? [version.replace(/^[\^~=]/, "")] : [];
            });
        });
}

export const imagePins: Guard = {
    id: "image-pins",
    description:
        "Every container image (Dockerfile FROM, image: in YAML, IMAGE= in a script) is pinned to a version, never latest, and the Playwright image matches the installed @playwright/test",
    profiles: "every",
    check(context) {
        const found = context.files.flatMap((file) =>
            isDockerfile(baseName(file)) || /\.(ya?ml|sh)$/.test(file) ? references(file, context.read(file)) : [],
        );
        const unpinned: Finding[] = found
            .filter(({ image }) => !image.includes("$") && !isPinned(image))
            .map(({ file, line, image }) => ({
                target: file,
                line,
                message: `${image} moves with every release, so builds stop being reproducible: pin it to a version (name:1.2.3) or a digest`,
            }));
        const installed = installedPlaywright(context);
        const playwright: Finding[] = found.flatMap(({ file, line, image }) => {
            const version = PLAYWRIGHT_IMAGE.exec(image)?.[1];
            if (version === undefined || installed.length === 0 || installed.includes(version)) return [];
            return [
                {
                    target: file,
                    line,
                    message: `the image has Playwright ${version}, the tests expect ${installed.join(", ")}: move it to mcr.microsoft.com/playwright:v${installed[0] ?? ""}-noble together with @playwright/test`,
                },
            ];
        });
        return [...unpinned, ...playwright];
    },
};
