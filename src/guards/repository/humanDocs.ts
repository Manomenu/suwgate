import type { Finding, Guard, GuardContext } from "../../gate/contract.ts";
import { moduleName } from "./justModules.ts";
import { baseName, inProfileDirectory, numberedLines } from "./text.ts";

const AGENT_SCRIPT = /(^|\/)\.internal\/|^[^/]+\.Gate\/scripts\//;
const AGENT_PATH = /\.internal\/|\.Gate\/scripts\//;
const FENCE = /^\s*(```|~~~)\s*([\w-]*)/;
const SHELL_FENCE = new Set(["", "sh", "bash", "zsh", "shell", "console", "shell-session", "powershell", "pwsh", "ps1", "cmd"]);
const CODE_SPAN = /(`+)(.+?)\1/g;
const DESCRIBED = /(\(|\b(runs|calls|starts|through|via)\s+)$/;
const VARIABLE = /^(?:export\s+)?([A-Za-z_][\w-]*)\s*:=/;
const RECIPE = /^@?([A-Za-z_][\w-]*)(?:\s[^:]*)?:(?!=)/;

interface Command {
    line: number;
    text: string;
}

function documentsOf(context: GuardContext): string[] {
    const folders = context.profiles.flatMap((profile) =>
        context.directories[profile] === undefined ? [] : [inProfileDirectory(context.directories, profile, "README.md")],
    );
    return [...new Set(["README.md", "docs/development.md", ...folders])].filter((file) => context.files.includes(file));
}

function commandsOf(text: string): Command[] {
    const commands: Command[] = [];
    let fence: string | undefined;
    for (const { line, text: content } of numberedLines(text)) {
        const marker = FENCE.exec(content);
        if (marker !== null) {
            fence = fence === undefined ? (marker[2] ?? "") : undefined;
        } else if (fence !== undefined) {
            if (SHELL_FENCE.has(fence) && content.trim() !== "") commands.push({ line, text: content.trim() });
        } else {
            for (const span of content.matchAll(CODE_SPAN)) {
                const code = (span[2] ?? "").trim();
                if (/\s/.test(code) && !DESCRIBED.test(content.slice(0, span.index))) commands.push({ line, text: code });
            }
        }
    }
    return commands;
}

function scriptIn(command: string, agentNames: ReadonlySet<string>): string | undefined {
    return command
        .split(/\s+/)
        .map((token) => token.replace(/^["'(]+|["'),;]+$/g, "").replace(/^\.\//, ""))
        .find((token) => AGENT_PATH.test(token) || agentNames.has(token));
}

function recipesCalling(context: GuardContext, script: string): string[] {
    const name = baseName(script);
    return context.files
        .filter((file) => file === "justfile" || file.endsWith(".just"))
        .flatMap((file) => {
            const prefix = file === "justfile" ? "" : `${moduleName(file)} `;
            const lines = numberedLines(context.read(file)).map((line) => line.text);
            const variables = lines.flatMap((text) => {
                const variable = VARIABLE.exec(text);
                return variable?.[1] !== undefined && text.includes(name) ? [variable[1]] : [];
            });
            const calls = (text: string) =>
                text.includes(name) || variables.some((variable) => new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`).test(text));
            let recipe: string | undefined;
            const found: string[] = [];
            for (const text of lines) {
                const header = /^\s/.test(text) ? null : RECIPE.exec(text);
                if (header !== null) recipe = header[1];
                else if (!/^\s/.test(text) && text.trim() !== "") recipe = undefined;
                else if (recipe !== undefined && calls(text)) found.push(`just ${prefix}${recipe}`);
            }
            return found;
        })
        .filter((recipe, index, all) => all.indexOf(recipe) === index);
}

function message(context: GuardContext, script: string): string {
    const recipes = recipesCalling(context, script);
    return recipes.length === 0
        ? `a person runs a just recipe, never ${script}, a script for agents: add a recipe that calls it to the justfile and name the recipe here (a doc may still name it to explain what runs it: in parentheses or after runs, calls or starts)`
        : `a person runs a just recipe, never ${script}, a script for agents: name \`${recipes.join("` or `")}\` instead (a doc may still name it to explain what runs it: in parentheses or after runs, calls or starts)`;
}

export const humanDocs: Guard = {
    id: "human-docs",
    description:
        "The docs for people (README.md, docs/development.md and the README of a profile's directory) never tell a person to run a script meant for agents (scripts/.internal/, <name>.Gate/scripts/): people run just recipes",
    profiles: "every",
    check(context) {
        const agentNames = new Set(context.files.filter((file) => AGENT_SCRIPT.test(file)).map(baseName));
        return documentsOf(context).flatMap((document) =>
            commandsOf(context.read(document)).flatMap(({ line, text }): Finding[] => {
                const script = scriptIn(text, agentNames);
                return script === undefined ? [] : [{ target: document, line, message: message(context, script) }];
            }),
        );
    },
};
