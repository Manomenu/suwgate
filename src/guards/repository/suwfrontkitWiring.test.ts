import { describe, expect, it } from "vitest";

import { suwfrontkitWiring } from "./suwfrontkitWiring.ts";
import { findingsOf } from "./testRepository.ts";

const APP = {
    "Myapp.Web/package.json": JSON.stringify({ dependencies: { "@maniumek/suwfrontkit": "0.3.0" } }),
    "Myapp.Web/index.html": '<html><body><script type="module" src="/src/main.tsx"></script></body></html>',
    "Myapp.Web/src/main.tsx": 'import "./index.css";\nimport { App } from "./App";\n',
};

const web = { profiles: ["web" as const], directories: { web: "Myapp.Web" } };

describe("suwfrontkit-wiring", () => {
    it("passes an app whose entry stylesheet or main module loads the kit's theme", async () => {
        expect(
            await findingsOf(suwfrontkitWiring, { ...APP, "Myapp.Web/src/index.css": '@import "@maniumek/suwfrontkit/theme.css";\n' }, web),
        ).toEqual([]);
        expect(
            await findingsOf(
                suwfrontkitWiring,
                { ...APP, "Myapp.Web/src/main.tsx": 'import "@maniumek/suwfrontkit/theme.css";\n', "Myapp.Web/src/index.css": "" },
                web,
            ),
        ).toEqual([]);
    });

    it("finds an app that installs the kit but never loads its theme, with the fix", async () => {
        const findings = await findingsOf(suwfrontkitWiring, { ...APP, "Myapp.Web/src/index.css": "body { margin: 0; }\n" }, web);

        expect(findings).toEqual([
            {
                target: "Myapp.Web/src/main.tsx",
                message: expect.stringContaining(
                    'add @import "@maniumek/suwfrontkit/theme.css"; at the top of the entry stylesheet',
                ) as unknown,
            },
        ]);
    });

    it("leaves alone a repository without the kit, and a library without an app page", async () => {
        const withoutKit = { ...APP, "Myapp.Web/package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }) };
        const library = { "package.json": JSON.stringify({ peerDependencies: { "@maniumek/suwfrontkit": "0.3.0" } }), "src/index.ts": "" };

        expect(await findingsOf(suwfrontkitWiring, withoutKit, web)).toEqual([]);
        expect(await findingsOf(suwfrontkitWiring, library)).toEqual([]);
    });
});
