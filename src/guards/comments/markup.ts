import { CRITERION_ID, commentGuard, fileName, scan, type FoundComment } from "./scan.ts";

const EXTENSIONS = [".props", ".targets", ".csproj", ".proj", ".slnx", ".config", ".html", ".svg", ".xml"];
const CRITERION_MARKER = new RegExp(`^<!-- ${CRITERION_ID} -->$`);

export function markupCommentsIn(file: string, text: string): FoundComment[] {
    const readsCriterionMarkers = fileName(file) === "Directory.Build.props";
    return scan(text, null, "", "<!--", "-->").filter((comment) => !(readsCriterionMarkers && CRITERION_MARKER.test(comment.text)));
}

export const commentsMarkup = commentGuard({
    id: "comments-markup",
    description:
        "No XML, HTML, SVG or MSBuild file holds a comment but a criterion id in Directory.Build.props, where the criteria check reads it",
    profiles: "every",
    scans: (file) => EXTENSIONS.some((extension) => file.endsWith(extension)),
    commentsIn: markupCommentsIn,
});
