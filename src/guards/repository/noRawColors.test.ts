import { describe, expect, it } from "vitest";

import { noRawColors } from "./noRawColors.ts";
import { findingsOf, shown } from "./testRepository.ts";

describe("no-raw-colors", () => {
    it.each([
        ['<div className="bg-[#ff0000]" />', true],
        ['const accent = "#1e66f5";', true],
        ["style={{ color: 'rgb(0 0 0)' }}", true],
        ["background: oklch(0.7 0.1 200)", true],
        ['<div className="bg-primary text-muted-foreground" />', false],
        ['style={{ color: "var(--primary)" }}', false],
        ['const mail = "&#106;&#64;&#x6a;";', false],
        ['const both = "&#106; #abc";', true],
    ])("judges %s", async (line, raw) => {
        const findings = await findingsOf(noRawColors, { "src/button/Button.tsx": line }, { profiles: ["web"] });
        expect(findings.length > 0).toBe(raw);
    });

    it("leaves the tests out, which may assert a colour value", async () => {
        const files = {
            "src/a.test.ts": "'#fff'",
            "src/b.spec.ts": "'#fff'",
            "src/c.e2e.ts": "'#fff'",
            "src/d.test.tsx": "'#fff'",
            "src/e.tsx": "'#fff'",
        };

        expect(shown(await findingsOf(noRawColors, files, { profiles: ["web"] }))).toEqual(["src/e.tsx:1"]);
    });

    it("reads the src/ folder of the web app by default, and nothing of a library", async () => {
        const files = { "Myapp.Web/src/a.tsx": "'#fff'", "Myapp.Web/e2e/b.ts": "'#fff'", "src/c.ts": "'#fff'" };

        expect(shown(await findingsOf(noRawColors, files, { profiles: ["web"], directories: { web: "Myapp.Web" } }))).toEqual([
            "Myapp.Web/src/a.tsx:1",
        ]);
        expect(await findingsOf(noRawColors, files, { profiles: ["library"] })).toEqual([]);
    });

    it("reads the folders its settings name", async () => {
        const files = { "src/theme/a.ts": "ok\n'#fff'", "src/b.css": "#fff" };
        const findings = await findingsOf(noRawColors, files, { profiles: ["library"], settings: { folders: ["src"] } });

        expect(shown(findings)).toEqual(["src/theme/a.ts:2"]);
        expect(findings[0]?.message).toContain("use a token class");
    });
});
