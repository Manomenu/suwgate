import { commentGuard, lineBreaks, type FoundComment } from "./scan.ts";

const LANGUAGE_MARKER = /^\/\*lang=\w+\*\/$/;
const GENERATED_MARKER = /^\/\/ <\/?auto-generated>$/;
const MESSAGE_DIRECTIVE = /^#\s*(region|endregion|error|warning)\b/;
const STRING_START = new Set(['"', "@", "$"]);
const GENERATED_FILE = /\.(g|Designer)\.cs$/;

interface Lexer {
    text: string;
    at: number;
    line: number;
    found: FoundComment[];
}

function run(text: string, at: number, sign: string): number {
    let end = at;
    while (text[end] === sign) end++;
    return end - at;
}

function advanceTo(lexer: Lexer, end: number): void {
    lexer.line += lineBreaks(lexer.text, lexer.at, end);
    lexer.at = end;
}

function comment(lexer: Lexer, end: number): void {
    lexer.found.push({ line: lexer.line, text: lexer.text.slice(lexer.at, end).trim() });
    advanceTo(lexer, end);
}

function atLineStart(text: string, at: number): boolean {
    const start = text.lastIndexOf("\n", at - 1) + 1;
    return text.slice(start, at).trim() === "";
}

function endOfLine(text: string, at: number): number {
    const newline = text.indexOf("\n", at);
    return newline < 0 ? text.length : newline;
}

function hole(lexer: Lexer): void {
    code(lexer, true);
}

function quotedString(lexer: Lexer, verbatim: boolean, interpolated: boolean): void {
    const { text } = lexer;
    lexer.at++;
    while (lexer.at < text.length) {
        const sign = text.charAt(lexer.at);
        if (sign === "\\" && !verbatim) {
            lexer.at += 2;
        } else if (sign === '"' && verbatim && text[lexer.at + 1] === '"') {
            lexer.at += 2;
        } else if (sign === '"') {
            lexer.at++;
            return;
        } else if (sign === "\n" && !verbatim) {
            return;
        } else if (interpolated && (sign === "{" || sign === "}") && text[lexer.at + 1] === sign) {
            lexer.at += 2;
        } else if (interpolated && sign === "{") {
            lexer.at++;
            hole(lexer);
        } else {
            if (sign === "\n") lexer.line++;
            lexer.at++;
        }
    }
}

function rawString(lexer: Lexer, quotes: number, dollars: number): void {
    const { text } = lexer;
    lexer.at += quotes;
    while (lexer.at < text.length) {
        const sign = text.charAt(lexer.at);
        if (sign === '"' && run(text, lexer.at, '"') >= quotes) {
            lexer.at += quotes;
            return;
        }
        const braces = sign === "{" ? run(text, lexer.at, "{") : 0;
        if (dollars > 0 && braces >= dollars) {
            lexer.at += braces;
            hole(lexer);
            lexer.at += Math.min(run(text, lexer.at, "}"), dollars - 1);
        } else {
            if (sign === "\n") lexer.line++;
            lexer.at += Math.max(braces, 1);
        }
    }
}

function stringAt(lexer: Lexer): boolean {
    const { text } = lexer;
    let at = lexer.at;
    let verbatim = text[at] === "@";
    if (verbatim) at++;
    const dollars = run(text, at, "$");
    at += dollars;
    if (!verbatim && text[at] === "@") {
        verbatim = true;
        at++;
    }
    if (text[at] !== '"') return false;
    lexer.at = at;
    const quotes = run(text, at, '"');
    if (!verbatim && quotes >= 3) rawString(lexer, quotes, dollars);
    else quotedString(lexer, verbatim, dollars > 0);
    return true;
}

function charLiteral(lexer: Lexer): void {
    const { text } = lexer;
    lexer.at++;
    while (lexer.at < text.length && text[lexer.at] !== "'" && text[lexer.at] !== "\n") {
        lexer.at += text[lexer.at] === "\\" ? 2 : 1;
    }
    if (text[lexer.at] === "'") lexer.at++;
}

function code(lexer: Lexer, inHole: boolean): void {
    const { text } = lexer;
    let depth = 0;
    while (lexer.at < text.length) {
        const sign = text.charAt(lexer.at);
        if (sign === "\n") {
            lexer.line++;
            lexer.at++;
        } else if (text.startsWith("//", lexer.at)) {
            comment(lexer, endOfLine(text, lexer.at));
        } else if (text.startsWith("/*", lexer.at)) {
            const close = text.indexOf("*/", lexer.at + 2);
            comment(lexer, close < 0 ? text.length : close + 2);
        } else if (sign === "#" && atLineStart(text, lexer.at) && MESSAGE_DIRECTIVE.test(text.slice(lexer.at, endOfLine(text, lexer.at)))) {
            lexer.at = endOfLine(text, lexer.at);
        } else if (sign === "'") {
            charLiteral(lexer);
        } else if (sign === "}" && inHole && depth === 0) {
            lexer.at++;
            return;
        } else if (!(STRING_START.has(sign) && stringAt(lexer))) {
            if (sign === "{") depth++;
            if (sign === "}") depth--;
            lexer.at++;
        }
    }
}

export function csharpCommentsIn(text: string): FoundComment[] {
    const lexer: Lexer = { text, at: 0, line: 1, found: [] };
    code(lexer, false);
    return lexer.found.filter((found) => !LANGUAGE_MARKER.test(found.text) && !GENERATED_MARKER.test(found.text));
}

export const commentsCsharp = commentGuard({
    id: "comments-csharp",
    description: "No C# file holds a comment (/// docs included) but the tool markers /*lang=…*/ and // <auto-generated>",
    profiles: ["dotnet"],
    scans: (file) => file.endsWith(".cs") && !GENERATED_FILE.test(file),
    commentsIn: (_, text) => csharpCommentsIn(text),
});
