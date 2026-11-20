import type { Rule } from "eslint";

const TOOL_DIRECTIVES = [/^ @ts-expect-error \S/, /^ @vitest-environment [\w-]+$/];
const CRITERION_MARKER = /^ AC-[a-z0-9]+(-[a-z0-9]+)*-[0-9]+$/;

export const noComments: Rule.RuleModule = {
    meta: {
        type: "problem",
        schema: [],
        docs: { description: 'Refuse every comment but the tool directives listed in AGENTS.md, "No comments"' },
        messages: {
            comment:
                'Delete the comment; rename or split the code so it explains itself; put lasting knowledge in a test, the README, docs/ or AGENTS.md (the only comments allowed are the tool directives listed in AGENTS.md, "No comments").',
        },
    },
    create(context) {
        const readsCriterionMarkers = context.filename.endsWith("eslint.config.js");
        return {
            Program() {
                for (const comment of context.sourceCode.getAllComments()) {
                    const allowed =
                        (comment.type as string) === "Shebang" ||
                        TOOL_DIRECTIVES.some((directive) => directive.test(comment.value)) ||
                        (readsCriterionMarkers && CRITERION_MARKER.test(comment.value));
                    if (!allowed && comment.loc) {
                        context.report({ loc: comment.loc, messageId: "comment" });
                    }
                }
            },
        };
    },
};
