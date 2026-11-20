import path from "node:path";

import type { StepContext } from "../gate/contract.ts";

function quoted(argument: string): string {
    return `'${argument.replaceAll("'", `'"'"'`)}'`;
}

export function changedIn(context: StepContext, pattern: RegExp): string[] {
    const prefix = path.relative(context.root, context.cwd);
    return context
        .changed()
        .filter((file) => prefix === "" || file.startsWith(`${prefix}/`))
        .map((file) => (prefix === "" ? file : file.slice(prefix.length + 1)))
        .filter((file) => pattern.test(file));
}

export function withChanged(context: StepContext, pattern: RegExp, command: string): string | null {
    const files = changedIn(context, pattern);
    return files.length === 0 ? null : `${command} ${files.map(quoted).join(" ")}`;
}
