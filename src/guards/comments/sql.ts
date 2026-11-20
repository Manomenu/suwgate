import { commentGuard, scan, type FoundComment } from "./scan.ts";

export function sqlCommentsIn(text: string): FoundComment[] {
    return scan(text, "--", "'\"");
}

export const commentsSql = commentGuard({
    id: "comments-sql",
    description: "No SQL file holds a comment",
    profiles: ["database"],
    scans: (file) => file.endsWith(".sql"),
    commentsIn: (_, text) => sqlCommentsIn(text),
});
