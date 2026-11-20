import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app, strict } from "./index.ts";

const SOURCES: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
        compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            lib: ["ES2022", "DOM"],
            noEmit: true,
        },
        include: ["src"],
    }),
    "src/main.ts":
        'import { notes } from "./notes/notes";\nimport { get } from "./api/client";\n\nexport const start = (): string => notes + get();\n',
    "src/api/client.ts": 'import { notes } from "../notes/notes";\n\nexport const get = (): string => notes;\n',
    "src/api/plain.ts": 'export const plain = "plain";\n',
    "src/design/button.ts": 'import { plain } from "../api/plain";\n\nexport const button: string = plain;\n',
    "src/api/styled.ts": 'import { button } from "../design/button";\n\nexport const styled: string = button;\n',
    "src/theme/colors.ts": 'import { plain } from "../api/plain";\n\nexport const colors: string = plain;\n',
    "src/notes/notes.ts":
        'import { user } from "../auth/auth";\nimport { label } from "./label";\n\nexport const notes: string = label + user;\n',
    "src/notes/label.ts": 'export const label = "notes";\n',
    "src/notes/client.ts": 'import { get } from "../api/client";\n\nexport const fetched = (): string => get();\n',
    "src/auth/auth.ts": 'export const user: string = localStorage.getItem("user") ?? window.sessionStorage.getItem("user") ?? "";\n',
    "src/auth/remembered.ts": 'export const remembered: string = localStorage.getItem("remembered") ?? "";\n',
    "src/auth/explained.ts": '// the user\nexport const explained = "user";\n',
    "src/stray/stray.ts": 'export const stray = "stray";\n',
};

let root = "";
const violations = new Map<string, string[]>();

beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "suwgate-preset-"));
    for (const [file, text] of Object.entries(SOURCES)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    const eslint = new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: app({
            root,
            features: ["notes", "auth"],
            shared: ["api", "design", "theme"],
            sharedImports: [["design", "api"]],
            storage: ["src/auth/remembered.ts"],
        }),
    });
    for (const result of await eslint.lintFiles(["src"])) {
        const rules = result.messages.map((message) => message.ruleId ?? message.message);
        violations.set(path.relative(root, result.filePath).split(path.sep).join("/"), rules);
    }
}, 60_000);

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("the app preset", () => {
    it("lets an entry file import features and shared folders, a feature itself and the shared folders", () => {
        expect(violations.get("src/main.ts")).toEqual([]);
        expect(violations.get("src/notes/client.ts")).toEqual([]);
        expect(violations.get("src/notes/label.ts")).toEqual([]);
    });

    it("refuses a feature importing another feature and a shared folder importing a feature", () => {
        expect(violations.get("src/notes/notes.ts")).toEqual(["boundaries/dependencies"]);
        expect(violations.get("src/api/client.ts")).toEqual(["boundaries/dependencies"]);
    });

    it("lets a shared folder import another only along an edge sharedImports names", () => {
        expect(violations.get("src/design/button.ts")).toEqual([]);
        expect(violations.get("src/api/styled.ts")).toEqual(["boundaries/dependencies"]);
        expect(violations.get("src/theme/colors.ts")).toEqual(["boundaries/dependencies"]);
    });

    it("refuses a folder of src/ that is neither a feature nor shared", () => {
        expect(violations.get("src/stray/stray.ts")).toEqual(["boundaries/no-unknown-files"]);
    });

    it("refuses browser storage outside the files it names", () => {
        expect(violations.get("src/auth/auth.ts")).toEqual(["no-restricted-globals", "no-restricted-properties"]);
        expect(violations.get("src/auth/remembered.ts")).toEqual([]);
    });

    it("refuses comments", () => {
        expect(violations.get("src/auth/explained.ts")).toEqual(["suwgate/no-comments"]);
    });
});

describe("the strict preset", () => {
    it("switches no-comments on as an error for every TypeScript and JavaScript file, and inline configuration off", () => {
        const configs = strict({ root: "/repo" });

        expect(configs).toContainEqual(expect.objectContaining({ rules: { "suwgate/no-comments": "error" } }));
        expect(configs).toContainEqual(expect.objectContaining({ linterOptions: { noInlineConfig: true } }));
    });
});
