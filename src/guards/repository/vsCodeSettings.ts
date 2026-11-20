import type { Finding, Guard } from "../../gate/contract.ts";
import { isRecord, parseJson } from "./text.ts";

const TOOL_PATHS = new Set(["prettier.prettierPath", "prettier.configPath", "prettier.ignorePath", "prettier.requireConfig"]);
const STYLE_KEY =
    /^(editor\.(tabSize|insertSpaces|detectIndentation|rulers|wordWrap|wordWrapColumn|trimAutoWhitespace|renderWhitespace)|files\.(eol|insertFinalNewline|trimFinalNewlines|trimTrailingWhitespace|encoding|autoGuessEncoding)|csharpier\..*|prettier\..*)$/;
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const SETTINGS = ".vscode/settings.json";
const EXTENSIONS = ".vscode/extensions.json";

export function isStyleKey(key: string): boolean {
    return STYLE_KEY.test(key) && !TOOL_PATHS.has(key);
}

function keys(value: Record<string, unknown>): string[] {
    return Object.entries(value).flatMap(([key, inner]) => (key.startsWith("[") && isRecord(inner) ? [key, ...keys(inner)] : [key]));
}

function notJson(file: string): Finding {
    return { target: file, message: "not valid JSON (comments and trailing commas included): fix the file so every tool can read it" };
}

function settingsFindings(text: string): Finding[] {
    const settings = parseJson(text);
    if (!isRecord(settings)) return [notJson(SETTINGS)];
    return keys(settings)
        .filter(isStyleKey)
        .map((key) => ({
            target: SETTINGS,
            message: `${key} is a style rule only VS Code reads: move it to .editorconfig, .prettierrc.json or .csharpierrc.json so every editor and the gate use it`,
        }));
}

function extensionFindings(text: string): Finding[] {
    const parsed = parseJson(text);
    const ids = isRecord(parsed) && Array.isArray(parsed["recommendations"]) ? (parsed["recommendations"] as unknown[]) : null;
    if (ids === null) return [notJson(EXTENSIONS)];
    return ids
        .filter((id, index) => typeof id !== "string" || !EXTENSION_ID.test(id) || ids.indexOf(id) !== index)
        .map((id) => ({
            target: EXTENSIONS,
            message: `${JSON.stringify(id)}: write each id once, as publisher.name in lower case (the Marketplace id from the extension's page)`,
        }));
}

export const vsCodeSettings: Guard = {
    id: "vscode-settings",
    description: "The VS Code settings hold glue and no style rules, and every recommended extension id is well formed and listed once",
    profiles: "every",
    check(context) {
        return [
            ...(context.files.includes(SETTINGS) ? settingsFindings(context.read(SETTINGS)) : []),
            ...(context.files.includes(EXTENSIONS) ? extensionFindings(context.read(EXTENSIONS)) : []),
        ];
    },
};
