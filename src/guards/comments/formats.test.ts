import { describe, expect, it } from "vitest";

import { cssCommentsIn } from "./css.ts";
import { jsonCommentsIn } from "./json.ts";
import { markupCommentsIn } from "./markup.ts";
import { sqlCommentsIn } from "./sql.ts";

describe("comments-css", () => {
    it.each([
        [":root { --radius: 0.5rem; }", 0],
        ["/* the palette */\n:root { --radius: 0.5rem; }", 1],
        [":root {\n  --radius: 0.5rem; /* rounder */\n}", 2],
        ['a { background: url(https://example.com/x.png); content: "/* no */"; }', 0],
    ])("finds the first comment in %j on line %d (0: none)", (text, line) => {
        expect(cssCommentsIn(text)[0]?.line ?? 0).toBe(line);
    });
});

describe("comments-json", () => {
    it.each([
        ["knip.json", '{ "a": 1 }', 0],
        ["knip.json", '{\n  // only points at the projects\n  "a": 1\n}', 2],
        ["knip.json", '{ "a": 1 /* a block */ }', 1],
        ["knip.json", '{ "$schema": "https://example.com/x.json", "b": "/* no */" }', 0],
        ["knip.json", '{ "a": "say \\"// no\\"" }', 0],
        ["tsconfig.json", "{\n  // AC-" + 'theme-1\n  "strict": true\n}', 0],
        ["Myapp.Web/tsconfig.app.json", "{\n  // AC-" + 'notes-1\n  "strict": true\n}', 0],
        ["Myapp.Web/tsconfig.app.json", "{\n  // AC-" + 'notes-1 keeps it strict\n  "strict": true\n}', 2],
        [".vscode/settings.json", "{\n  // AC-" + 'notes-1\n  "a": 1\n}', 2],
    ] as const)("finds the first comment of %s on line %d (0: none) (%#)", (file, text, line) => {
        expect(jsonCommentsIn(file, text)[0]?.line ?? 0).toBe(line);
    });
});

describe("comments-markup", () => {
    it.each([
        ["Myapp.Server/Myapp.Server.csproj", "<Project>\n  <PropertyGroup />\n</Project>", 0],
        ["nuget.config", '<?xml version="1.0"?>\n<!--\n  nuget.org only\n-->\n<configuration />', 2],
        ["scripts/init-project.proj", "<Project>\n  <!-- the post action -->\n</Project>", 2],
        ["Myapp.Web/index.html", '<html>\n<body><!-- the app mounts here --><div id="root"></div></body>\n</html>', 2],
        ["public/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg">\n  <!-- the logo -->\n</svg>', 2],
        ["Directory.Build.props", "<Project>\n  <!-- AC-" + "notes-1 -->\n  <PropertyGroup />\n</Project>", 0],
        ["Directory.Build.props", "<Project>\n  <!-- AC-" + "notes-1: strict -->\n</Project>", 2],
        ["Myapp.Server/Myapp.Server.csproj", "<Project>\n  <!-- AC-" + "notes-1 -->\n</Project>", 2],
    ] as const)("finds the first comment of %s on line %d (0: none) (%#)", (file, text, line) => {
        expect(markupCommentsIn(file, text)[0]?.line ?? 0).toBe(line);
    });
});

describe("comments-sql", () => {
    it.each([
        ["create table note (id bigint);", 0],
        ["-- the notes\ncreate table note (id bigint);", 1],
        ["create table note (\n  id bigint -- the key\n);", 2],
        ["create table note (id bigint); /* later */", 1],
        ["insert into note values ('-- no', 'it''s /* no */');", 0],
        ['create table "x--y" (id bigint);', 0],
    ])("finds the first comment in %j on line %d (0: none)", (text, line) => {
        expect(sqlCommentsIn(text)[0]?.line ?? 0).toBe(line);
    });
});
