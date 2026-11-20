import { commentGuard, scan, type FoundComment } from "./scan.ts";

export function cssCommentsIn(text: string): FoundComment[] {
    return scan(text, null, "'\"");
}

export const commentsCss = commentGuard({
    id: "comments-css",
    description: "No CSS file holds a comment",
    profiles: ["web", "library"],
    scans: (file) => file.endsWith(".css"),
    commentsIn: (_, text) => cssCommentsIn(text),
});
