import type { Finding, Guard } from "../../gate/contract.ts";
import { lineAt, numberedLines } from "./text.ts";

const FIX =
    "a test never measures, waits on or limits real time, so it neither flakes on a slow machine nor promises speed: to prove a retry or a timeout, give the code a TimeProvider and advance a FakeTimeProvider (in Vitest, vi.useFakeTimers() and vi.advanceTimersByTime()); to see that something happened, await the event (a task, a signal, Playwright's auto-waiting expect, a later event that must come after it); a speed promise, in milliseconds or in steps counted instead of them, does not belong on the gate, so drop it and its criterion";

const CSHARP_TEST = /(^|\/)[^/]+\.Test(s|ing)\/.+\.cs$/;
const WEB_TEST = /\.(test|spec|e2e|visual|stories)\.[cm]?[jt]sx?$/;
const E2E_HELPER = /(^|\/)e2e\/.+\.[cm]?[jt]sx?$/;
const TOOL_CONFIG = /\.config\.[cm]?[jt]s$/;
const VITEST_TEST = /\.test\.[cm]?[jt]sx?$/;
const FAKE_TIMERS = /\buseFakeTimers\s*\(/;
const WAITS_FOR_AN_EVENT = /(^|\.)(waitFor|find(All)?By\w+)$|^vi\.waitUntil$|^expect\.poll$/;

interface Rule {
    pattern: RegExp;
    verb: string;
    fix?: string;
}

interface CallRule extends Rule {
    allowed(call: Call): boolean;
}

interface WebRule extends Rule {
    name: string;
    faked?: boolean;
    vitestOnly?: boolean;
    allowed?: (source: string, at: number) => boolean;
}

interface Call {
    text: string;
    at: number;
    args: string[];
}

const MEASURES = "measures real time";
const READS_CLOCK = "reads the real clock";
const WAITS = "waits on real time";
const LIMITS = "limits the test in real time";
const REAL_CLOCK_FIX =
    "a test runs on a FakeTimeProvider (Microsoft.Extensions.Time.Testing), never on the real clock: hand the code a new FakeTimeProvider() and move time with its Advance or SetUtcNow";

const CSHARP_RULES: readonly Rule[] = [
    { pattern: /\b(?<found>Stopwatch|GetElapsedTime|GetTimestamp|TickCount64|TickCount)\b/dg, verb: MEASURES },
    { pattern: /\b(?<found>(DateTime|DateTimeOffset)\.(Now|UtcNow|Today))\b/dg, verb: READS_CLOCK },
    { pattern: /\b(?<found>Thread\.Sleep)\b/dg, verb: "sleeps on real time" },
    { pattern: /\[[^[\]]*?\b(?<found>Timeout\s*=)(?!=)/dg, verb: LIMITS },
    { pattern: /\b(?<found>TimeProvider\.System)\b/dg, verb: "is the real clock, not a FakeTimeProvider", fix: REAL_CLOCK_FIX },
];

const FAKE_CLOCK = /provider|clock/i;
const onFakeClock = (call: Call): boolean => call.args.slice(1).some((arg) => FAKE_CLOCK.test(arg));

const CONSTRUCTED = /\bnew\s+(?<type>[A-Za-z_][\w.]*)\s*(?:<[^<>()]*>)?\s*\(|\bnew\s*\(/g;
const INTERVAL = /^(?:\w+\s*:\s*)?(?:TimeSpan\.From\w+\s*\(|new\s+TimeSpan\s*\()/;
const NOT_A_WAIT = new Set(["CancellationTokenSource", "DateTimeOffset", "TimeSpan"]);
const DECLARED_TYPE = /\b(?<type>[A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s+[A-Za-z_]\w*\s*=\s*$/;

const CSHARP_CALLS: readonly CallRule[] = [
    {
        pattern: /\bTask\.Delay\s*\(/g,
        verb: `${WAITS} outside a polling loop`,
        allowed: (call) => onFakeClock(call) || /^Timeout\.Infinite(TimeSpan)?$/.test(call.args[0] ?? "") || insideLoop(call.text, call.at),
    },
];

const WEB_RULES: readonly WebRule[] = [
    { name: "performance.now", pattern: /\bperformance\.now\b/, verb: MEASURES, faked: true },
    { name: "Date.now()", pattern: /\bDate\.now\(\)\s*-|-\s*Date\.now\(\)/, verb: MEASURES, faked: true },
    { name: "setTimeout", pattern: /\bsetTimeout\s*\(/, verb: "waits on or limits real time", faked: true },
    { name: "sleep or delay", pattern: /\b(sleep|delay)\(\s*\d/, verb: WAITS, faked: true },
    { name: "waitForTimeout", pattern: /\bwaitForTimeout\b/, verb: WAITS },
    { name: "interruptAfterTimeLimit", pattern: /\binterruptAfterTimeLimit\b/, verb: LIMITS },
    {
        name: "timeout:",
        pattern: /\btimeout\s*:\s*[1-9]/,
        verb: LIMITS,
        vitestOnly: true,
        allowed: (source, at) => WAITS_FOR_AN_EVENT.test(enclosingCall(source, at)),
    },
];

function enclosingCall(source: string, at: number): string {
    let depth = 0;
    for (let position = at - 1; position >= 0; position--) {
        const sign = source.charAt(position);
        if (")]}".includes(sign)) depth++;
        else if ("([{".includes(sign) && depth > 0) depth--;
        else if (sign === "(") return /[\w$.]*$/.exec(source.slice(0, position).trimEnd())?.[0] ?? "";
    }
    return "";
}

function blank(text: string): string {
    return text.replace(/[^\n]/g, " ");
}

function quoteRun(text: string, at: number): number {
    let end = at;
    while (text[end] === '"') end++;
    return end - at;
}

function literalEnd(text: string, at: number): number {
    const quotes = quoteRun(text, at);
    if (quotes >= 3) {
        let end = at + quotes;
        while (end < text.length && !(text[end] === '"' && quoteRun(text, end) >= quotes)) end++;
        return Math.min(text.length, end + quotes);
    }
    if (quotes === 2) return at + 2;
    const verbatim = /@\$?$|\$@$/.test(text.slice(Math.max(0, at - 2), at));
    let end = at + 1;
    while (end < text.length) {
        const sign = text[end];
        if (sign === "\\" && !verbatim) end += 2;
        else if (sign === '"' && verbatim && text[end + 1] === '"') end += 2;
        else if (sign === '"' || (sign === "\n" && !verbatim)) return end + 1;
        else end++;
    }
    return text.length;
}

function charEnd(text: string, at: number): number {
    const close = text.indexOf("'", text[at + 1] === "\\" ? at + 3 : at + 2);
    return close === -1 || close - at > 10 ? at + 1 : close + 1;
}

function endOfSkipped(text: string, at: number): number | undefined {
    const sign = text.charAt(at);
    const next = text.charAt(at + 1);
    if (sign === "/" && next === "/") return text.includes("\n", at) ? text.indexOf("\n", at) : text.length;
    if (sign === "/" && next === "*") return text.includes("*/", at + 2) ? text.indexOf("*/", at + 2) + 2 : text.length;
    if (sign === '"') return literalEnd(text, at);
    return sign === "'" ? charEnd(text, at) : undefined;
}

function codeOnly(text: string): string {
    let kept = "";
    let at = 0;
    while (at < text.length) {
        const end = endOfSkipped(text, at);
        kept += end === undefined ? text.charAt(at) : blank(text.slice(at, end));
        at = end ?? at + 1;
    }
    return kept;
}

function matchingBackwards(text: string, close: number, open: string, closing: string): number {
    let depth = 0;
    for (let at = close; at >= 0; at--) {
        if (text[at] === closing) depth++;
        else if (text[at] === open && --depth === 0) return at;
    }
    return -1;
}

function isLoopHeader(header: string, text: string, end: number): boolean {
    if (/\bdo$/.test(header)) return true;
    if (!header.endsWith(")")) return false;
    const open = matchingBackwards(text, end, "(", ")");
    return open > 0 && /\b(while|for|foreach)\s*$/.test(text.slice(0, open));
}

function statementStart(text: string, at: number): number {
    let depth = 0;
    for (let position = at - 1; position >= 0; position--) {
        const sign = text.charAt(position);
        if (sign === ")") depth++;
        else if (sign === "(") depth--;
        else if (depth === 0 && (sign === ";" || sign === "{" || sign === "}")) return position + 1;
    }
    return 0;
}

function insideLoop(text: string, at: number): boolean {
    if (/^\s*(while|for|foreach)\s*\(/.test(text.slice(statementStart(text, at), at))) return true;
    let depth = 0;
    for (let position = at - 1; position >= 0; position--) {
        if (text[position] === "}") depth++;
        else if (text[position] === "{" && depth > 0) depth--;
        else if (text[position] === "{") {
            const header = text.slice(0, position).trimEnd();
            if (isLoopHeader(header, text, header.length - 1)) return true;
        }
    }
    return false;
}

function argumentsOf(text: string, open: number): string[] {
    const args: string[] = [];
    let depth = 0;
    let start = open + 1;
    for (let at = open; at < text.length; at++) {
        const sign = text[at];
        if (sign === "(" || sign === "[" || sign === "{") depth++;
        else if (sign === ")" || sign === "]" || sign === "}") depth--;
        if ((depth === 1 && sign === ",") || depth === 0) {
            args.push(text.slice(start, at).trim());
            start = at + 1;
        }
        if (depth === 0) break;
    }
    return args.filter((arg) => arg !== "");
}

function finding(file: string, line: number, found: string, verb: string, fix = FIX): Finding {
    return { target: file, line, message: `${found.replace(/\s+/g, " ")} ${verb}: ${fix}` };
}

function constructedType(text: string, match: RegExpExecArray): string {
    const named = match.groups?.["type"];
    if (named !== undefined) return named.split(".").at(-1) ?? named;
    return DECLARED_TYPE.exec(text.slice(0, match.index))?.groups?.["type"] ?? "";
}

function constructorFindings(file: string, text: string): Finding[] {
    return [...text.matchAll(CONSTRUCTED)].flatMap((match) => {
        const type = constructedType(text, match);
        if (NOT_A_WAIT.has(type)) return [];
        const args = argumentsOf(text, match.index + match[0].length - 1);
        const interval = args.find((arg) => INTERVAL.test(arg));
        if (interval === undefined || args.some((arg) => FAKE_CLOCK.test(arg))) return [];
        return [
            finding(
                file,
                lineAt(text, match.index),
                `${interval.replace(/^\w+\s*:\s*/, "")} handed to new ${type}(…)`,
                "gives the code a real-time interval without a TimeProvider",
                `${FIX}; a ceiling against a hang stays allowed (new CancellationTokenSource(<delay>), CancelAfter, WaitAsync(<TimeSpan>), an HttpClient's Timeout)`,
            ),
        ];
    });
}

function csharpFindings(file: string, source: string): Finding[] {
    const text = codeOnly(source);
    const plain = CSHARP_RULES.flatMap((rule) =>
        [...text.matchAll(rule.pattern)].flatMap((match) => {
            const found = match.indices?.groups?.["found"];
            return found === undefined ? [] : [finding(file, lineAt(text, found[0]), text.slice(found[0], found[1]), rule.verb, rule.fix)];
        }),
    );
    const calls = CSHARP_CALLS.flatMap((rule) =>
        [...text.matchAll(rule.pattern)]
            .filter((match) => !rule.allowed({ text, at: match.index, args: argumentsOf(text, match.index + match[0].length - 1) }))
            .map((match) => finding(file, lineAt(text, match.index), match[0].replace(/^\.|\s*\($/g, ""), rule.verb)),
    );
    return [...plain, ...calls, ...constructorFindings(file, text)].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

function webFindings(file: string, source: string): Finding[] {
    const faked = FAKE_TIMERS.test(source);
    const rules = WEB_RULES.filter((rule) => !(faked && rule.faked) && (VITEST_TEST.test(file) || rule.vitestOnly !== true));
    let start = 0;
    return numberedLines(source).flatMap(({ line, text }) => {
        const lineStart = start;
        start = source.indexOf("\n", start) + 1;
        return rules.flatMap((rule) => {
            const matches = [...text.matchAll(new RegExp(rule.pattern, "g"))];
            const found = matches.some((match) => rule.allowed?.(source, lineStart + match.index) !== true);
            return found ? [finding(file, line, rule.name, rule.verb)] : [];
        });
    });
}

function isWebTest(file: string): boolean {
    return !file.includes("node_modules/") && !TOOL_CONFIG.test(file) && (WEB_TEST.test(file) || E2E_HELPER.test(file));
}

export const testTiming: Guard = {
    id: "test-timing",
    description:
        "No test measures, sleeps on, waits for or limits real time (the .cs files of *.Tests and *.Testing projects; *.test, *.spec, *.e2e, *.visual and *.stories files and e2e/ helpers): tests drive a fake clock",
    profiles: ["dotnet", "web", "library"],
    check(context) {
        return context.files.flatMap((file) => {
            if (CSHARP_TEST.test(file)) return csharpFindings(file, context.read(file));
            return isWebTest(file) ? webFindings(file, context.read(file)) : [];
        });
    },
};
