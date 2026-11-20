import { describe, expect, it } from "vitest";

import { switchesIn } from "./switches.ts";

const IGNORE = "@ts-" + "ignore";
const NOCHECK = "@ts-" + "nocheck";
const DISABLE = "eslint-" + "disable";

describe("no-in-place-switches", () => {
    it.each([
        ["src/a.ts", `// ${IGNORE}\nf(1);`, 1],
        ["src/a.ts", `/* ${IGNORE} */ f(1);`, 1],
        ["src/a.js", `// ${NOCHECK}\nf(1);`, 1],
        ["src/a.tsx", `f(1);\n// ${DISABLE}-next-line no-console\nconsole.log(1);`, 2],
        ["src/a.mjs", `console.log(1); // ${DISABLE}-line`, 1],
        ["src/a.ts", `/* ${DISABLE} */\nf(1);`, 1],
        ["src/a.ts", "/* eslint" + " no-console: off */\nf(1);", 1],
        ["src/a.ts", "// @ts-expect-error the overload is missing\nf(1);", 0],
        ["src/a.ts", 'const docs = "https://eslint.org/docs";', 0],
        ["X.cs", "#pragma warning disable CA1000\nclass X;", 1],
        ["X.cs", "class X;\n  #  pragma warning disable", 2],
        ["X.cs", "#pragma warning restore CA1000\nclass X;", 0],
        ["X.cs", '[SuppressMessage("Design", "CA1000", Justification = "xUnit")]\nclass X;', 0],
        ["notes.md", `// ${IGNORE}`, 0],
    ] as const)("finds the first switch of %s on line %d (0: none) (%#)", (file, text, line) => {
        expect(switchesIn(file, text)[0]?.line ?? 0).toBe(line);
    });

    it("says how to fix a switch", () => {
        expect(switchesIn("X.cs", "#pragma warning disable CA1000")).toEqual([
            {
                target: "X.cs",
                line: 1,
                message:
                    "#pragma warning disable switches a check off in place: fix the code; a rule that does not fit is switched off in .editorconfig, or [SuppressMessage(..., Justification = ...)] goes on the member",
            },
        ]);
    });
});
