import type { Guard } from "../../gate/contract.ts";

const CRITERIA_FILE = "criteria.json";

const DOCUMENTS = ["README.md", "docs/development.md"];

function row(line: string): string {
    return line.replace(/\s+\|/g, " |").replace(/\|\s+/g, "| ");
}

function kindsOf(text: string): string[] | null {
    try {
        const parsed = JSON.parse(text) as { kinds?: unknown };
        if (parsed.kinds === undefined) return [];
        if (!Array.isArray(parsed.kinds)) return null;
        return parsed.kinds.map((kind: unknown) =>
            kind !== null && typeof kind === "object" && "kind" in kind && typeof kind.kind === "string" ? kind.kind : "",
        );
    } catch {
        return null;
    }
}

export const criteriaKinds: Guard = {
    id: "criteria-kinds",
    description:
        "Every kind of guardrail criteria.json adds to the defaults of the profiles is explained in a table of README.md or docs/development.md",
    profiles: "every",
    check(context) {
        if (!context.files.includes(CRITERIA_FILE)) return [];
        const kinds = kindsOf(context.read(CRITERIA_FILE));
        if (kinds === null) {
            return [
                {
                    target: CRITERIA_FILE,
                    message:
                        'not a list of kinds: write { "kinds": [{ "kind": "<name>", "paths": ["<glob>"], "how": "<how the id is written>" }] }',
                },
            ];
        }
        const rows = DOCUMENTS.filter((document) => context.files.includes(document)).flatMap((document) =>
            context.read(document).split("\n").map(row),
        );
        return kinds
            .filter((kind) => !rows.some((line) => line.includes(`| \`${kind}\` |`)))
            .map((kind) => ({
                target: kind === "" ? CRITERIA_FILE : kind,
                message:
                    kind === ""
                        ? 'a kind without a name: give each kind of criteria.json its "kind"'
                        : `no row explains this kind of guardrail of ${CRITERIA_FILE}: add \`| \`${kind}\` | where | how it names the id |\` to a table of ${DOCUMENTS.join(" or ")}`,
            }));
    },
};
