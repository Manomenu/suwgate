import { describe, expect, it } from "vitest";

import { FORBIDDEN_BY_PROFILE, forbiddenIn, forbiddenNames } from "./forbiddenNames.ts";
import { findingsOf, shown } from "./testRepository.ts";

const DOTNET = ["utils", "base", ...FORBIDDEN_BY_PROFILE.dotnet];
const WEB = ["utils", "helpers", "manager", "base", ...FORBIDDEN_BY_PROFILE.web];

describe("forbidden-names", () => {
    it.each([
        ["StringHelpers", WEB, "helpers"],
        ["utils", WEB, "utils"],
        ["ui", WEB, "ui"],
        ["Components", WEB, "components"],
        ["OutputManager", WEB, "manager"],
        ["Dtos", DOTNET, "dtos"],
        ["DTOs", DOTNET, "dtos"],
        ["Myapp.Services", DOTNET, "services"],
        ["Base", DOTNET, "base"],
        ["Database", DOTNET, undefined],
        ["Notes", DOTNET, undefined],
        ["appShell", WEB, undefined],
        ["building", WEB, undefined],
        ["infoTip", WEB, undefined],
    ])("finds a forbidden word by its words, not by its letters: %s", (name, forbidden, expected) => {
        expect(forbiddenIn(name, forbidden)).toBe(expected);
    });

    it("checks every folder, project and file once, with the words of the repository's profiles", async () => {
        const files = {
            "src/utils/format.ts": "",
            "src/utils/date.ts": "",
            "src/notes/noteList.tsx": "",
            "Myapp.Services/Myapp.Services.csproj": "",
            "src/hooks/useNotes.ts": "",
        };

        expect(shown(await findingsOf(forbiddenNames, files, { profiles: ["dotnet"] }))).toEqual([
            "Myapp.Services",
            "Myapp.Services/Myapp.Services.csproj",
            "src/utils",
        ]);
        expect(shown(await findingsOf(forbiddenNames, files, { profiles: ["web"] }))).toEqual(["src/hooks", "src/utils"]);
    });

    it("judges a file only by the vague words, since a file named after a kind is one thing of that kind", async () => {
        const files = {
            "src/hooks.ts": "",
            "src/utils.ts": "",
            "Design/InterfacesHaveTwoImplementations.cs": "",
            "Myapp.Models.csproj": "",
        };

        expect(shown(await findingsOf(forbiddenNames, files, { profiles: ["web", "dotnet"] }))).toEqual([
            "Myapp.Models.csproj",
            "src/utils.ts",
        ]);
    });

    it("leaves AGENTS.shared.md alone, a name suwgate gives every repository", async () => {
        expect(await findingsOf(forbiddenNames, { "AGENTS.shared.md": "", "src/shared.ts": "" })).toEqual([
            expect.objectContaining({ target: "src/shared.ts" }),
        ]);
    });

    it("lets a file carry Base, as a type may, and refuses it as a folder or project, as a namespace segment", async () => {
        const files = {
            "Myapp.Server/KnowledgeBases/KnowledgeBaseView.cs": "",
            "src/knowledge-bases/knowledgeBaseForm.ts": "",
            "Myapp.Server/Base/Entity.cs": "",
        };

        expect(shown(await findingsOf(forbiddenNames, files, { profiles: ["web", "dotnet"] }))).toEqual(["Myapp.Server/Base"]);
    });

    it("takes more words and ignored paths from its settings", async () => {
        const files = { "src/stores/notes.ts": "", "visual/snapshots/ui--button.png": "" };

        expect(
            shown(
                await findingsOf(forbiddenNames, files, {
                    profiles: ["web"],
                    settings: { words: ["Stores"], ignore: ["visual/snapshots/**"] },
                }),
            ),
        ).toEqual(["src/stores"]);
    });

    it("says how to rename it", async () => {
        const [finding] = await findingsOf(forbiddenNames, { "src/shared/a.ts": "" });
        expect(finding?.message).toContain('"shared" names who uses it');
    });
});
