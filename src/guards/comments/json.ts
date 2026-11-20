import { CRITERION_ID, commentGuard, fileName, scan, type FoundComment } from "./scan.ts";

const CRITERION_MARKER = new RegExp(`^// ${CRITERION_ID}$`);

export function jsonCommentsIn(file: string, text: string): FoundComment[] {
    const readsCriterionMarkers = /^tsconfig[\w.-]*\.json$/.test(fileName(file));
    return scan(text, "//", '"').filter((comment) => !(readsCriterionMarkers && CRITERION_MARKER.test(comment.text)));
}

export const commentsJson = commentGuard({
    id: "comments-json",
    description: "No JSON file holds a comment but a criterion id on its own line in a tsconfig, where the criteria check reads it",
    profiles: "every",
    scans: (file) => file.endsWith(".json") || file.endsWith(".jsonc"),
    commentsIn: jsonCommentsIn,
});
