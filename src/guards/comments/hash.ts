import { CRITERION_ID, commentGuard, fileName, type FoundComment } from "./scan.ts";

const ALL_COMMENTS_ARE_SETTINGS = ".env.example";
const IGNORE_FILE = /^\.[\w-]*ignore$/;
const WHOLE_LINE_ONLY = new Set([".gitattributes", ".editorconfig"]);
const ALSO_AT_THE_END_OF_A_LINE = [".sh", ".bash", ".yaml", ".yml", ".rsp"];
const NGINX = new Set(["nginx.conf", "nginx.conf.template"]);
const SHELLCHECK_DIRECTIVE = /^# shellcheck (disable|enable|source|shell|external-sources)=\S+$/;
const DOCKERFILE_SYNTAX = /^# syntax=\S+$/;
const EDITORCONFIG_CRITERION = new RegExp(`^# ${CRITERION_ID}$`);
const RECIPE_OR_MODULE = /^(@?[A-Za-z_][\w-]*(\s+[^:]*)?:(?!=)|mod\??\s+[\w-]+(\s+(['"])[^'"]+\4)?\s*$)/;
const BLOCK_SCALAR = /^(\s*)((?:-\s+)*)(?:([^\s#][^#]*?):\s+)?[|>](?:[1-9][-+]?|[-+][1-9]?)?\s*(?:#.*)?$/;

const isJust = (file: string) => ["justfile", ".justfile"].includes(fileName(file).toLowerCase()) || file.endsWith(".just");
const isShell = (file: string) => file.endsWith(".sh") || file.endsWith(".bash") || file.startsWith(".githooks/");
const isDockerfile = (file: string) => /^Dockerfile(\..+)?$/.test(fileName(file)) || file.endsWith(".Dockerfile");
const isEditorconfig = (file: string) => fileName(file) === ".editorconfig";
const alsoAtTheEnd = (file: string) =>
    isShell(file) || NGINX.has(fileName(file)) || ALSO_AT_THE_END_OF_A_LINE.some((extension) => file.endsWith(extension));

function usesHashComments(file: string): boolean {
    const name = fileName(file);
    return (
        name !== ALL_COMMENTS_ARE_SETTINGS &&
        (isJust(file) || isDockerfile(file) || IGNORE_FILE.test(name) || WHOLE_LINE_ONLY.has(name) || alsoAtTheEnd(file))
    );
}

function commentAtTheEnd(line: string): string | null {
    let quote = "";
    for (let at = 0; at < line.length; at++) {
        const sign = line.charAt(at);
        if (quote !== "") {
            if (sign === "\\" && quote === '"') at++;
            else if (sign === quote) quote = "";
        } else if (sign === '"' || sign === "'") {
            quote = sign;
        } else if (sign === "#" && at > 0 && /\s/.test(line.charAt(at - 1))) {
            return line.slice(at).trimEnd();
        }
    }
    return null;
}

function commentOn(file: string, line: string): string | null {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#") || (isEditorconfig(file) && trimmed.startsWith(";"))) return trimmed.trimEnd();
    return alsoAtTheEnd(file) ? commentAtTheEnd(line) : null;
}

function describesTheRecipeBelow(lines: readonly string[], index: number): boolean {
    let next = index + 1;
    while (next < lines.length && (lines[next] ?? "").startsWith("[") && !(lines[next] ?? "").startsWith("[private]")) next++;
    return next < lines.length && RECIPE_OR_MODULE.test(lines[next] ?? "");
}

function isAllowed(file: string, lines: readonly string[], index: number, comment: string): boolean {
    return (
        (index === 0 && comment.startsWith("#!")) ||
        (isShell(file) && SHELLCHECK_DIRECTIVE.test(comment)) ||
        (isDockerfile(file) && index === 0 && DOCKERFILE_SYNTAX.test(comment)) ||
        (isEditorconfig(file) && EDITORCONFIG_CRITERION.test(comment)) ||
        (isJust(file) && describesTheRecipeBelow(lines, index))
    );
}

const isYaml = (file: string) => file.endsWith(".yaml") || file.endsWith(".yml");

const indentOf = (line: string) => line.length - line.trimStart().length;

function blockScalarLines(lines: readonly string[]): Set<number> {
    const inside = new Set<number>();
    let parent: number | null = null;
    lines.forEach((line, index) => {
        if (parent !== null && (line.trim() === "" || indentOf(line) > parent)) {
            inside.add(index);
            return;
        }
        parent = null;
        const start = BLOCK_SCALAR.exec(line);
        if (start !== null) parent = (start[1] ?? "").length + (start[3] === undefined ? 0 : (start[2] ?? "").length);
    });
    return inside;
}

export function hashCommentsIn(file: string, text: string): FoundComment[] {
    const lines = text.split("\n");
    const literal = isYaml(file) ? blockScalarLines(lines) : new Set<number>();
    return lines.flatMap((line, index) => {
        if (literal.has(index)) return [];
        const comment = commentOn(file, line);
        return comment !== null && !isAllowed(file, lines, index, comment) ? [{ line: index + 1, text: comment }] : [];
    });
}

export const commentsHash = commentGuard({
    id: "comments-hash",
    description:
        "No shell, YAML, Dockerfile, ignore, .editorconfig, justfile, nginx or .rsp file holds a comment but a tool directive (a shebang, shellcheck, Dockerfile syntax, a criterion id in .editorconfig, the justfile recipe line; .env.example keeps its comments)",
    profiles: "every",
    scans: usesHashComments,
    commentsIn: hashCommentsIn,
});
