import type { Guard } from "../../gate/contract.ts";
import { inProfileDirectory, numberedLines, stringList } from "./text.ts";

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab)\(|\[#/;
const CODE_FILE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE = /\.(test|spec|e2e)\.(ts|tsx|js|jsx)$/;

interface Settings {
    folders?: string[];
}

export const noRawColors: Guard = {
    id: "no-raw-colors",
    description:
        "Components use the theme's tokens, never a colour value of their own; it reads the src/ folder of a web app, and the folders settings name, but not the tests",
    profiles: ["web", "library"],
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            folders: { ...stringList, description: "The folders of components, relative to the root (default: src/ of the web app)." },
        },
    },
    check(context) {
        const settings = (context.settings ?? {}) as Settings;
        const defaults = context.profiles.includes("web") ? [inProfileDirectory(context.directories, "web", "src/")] : [];
        const folders = (settings.folders ?? defaults).map((folder) => `${folder.replace(/\/+$/, "")}/`);
        return context.files
            .filter((file) => CODE_FILE.test(file) && !TEST_FILE.test(file) && folders.some((folder) => file.startsWith(folder)))
            .flatMap((file) =>
                numberedLines(context.read(file))
                    .filter(({ text }) => RAW_COLOR.test(text))
                    .map(({ line }) => ({
                        target: file,
                        line,
                        message:
                            "a colour value of its own drifts from the theme and breaks dark mode: use a token class (bg-primary, text-muted-foreground) or var(--token), and add a new colour to the theme's tokens",
                    })),
            );
    },
};
