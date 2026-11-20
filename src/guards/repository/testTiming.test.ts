import { describe, expect, it } from "vitest";

import { testTiming } from "./testTiming.ts";
import { findingsOf, shown } from "./testRepository.ts";

const TEST = "Myapp.Server.Tests/Notes/NotesTests.cs";

const inTest = (body: string) => `public sealed class NotesTests\n{\n    [Fact]\n    public async Task Saves()\n    {\n${body}\n    }\n}\n`;

const csharp = async (body: string, file = TEST) => shown(await findingsOf(testTiming, { [file]: inTest(body) }));

const web = async (file: string, text: string) => shown(await findingsOf(testTiming, { [file]: text }));

describe("test-timing", () => {
    it.each([
        "var watch = Stopwatch.StartNew();",
        "var start = provider.GetTimestamp();",
        "var elapsed = provider.GetElapsedTime(start);",
        "var ticks = Environment.TickCount64;",
        "var now = DateTime.Now;",
        "var now = DateTimeOffset.UtcNow;",
        "var today = DateTime.Today;",
        "Thread.Sleep(100);",
        "System.Threading.Thread.Sleep(100);",
        "await Task.Delay(500);",
        "await Task.Delay(TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken);",
    ])("finds a .NET test that measures, sleeps on or limits real time: %s", async (body) => {
        expect(await csharp(body)).toEqual([`${TEST}:6`]);
    });

    it("finds a test that sets itself a time limit in its attribute", async () => {
        const text = "public sealed class NotesTests\n{\n    [Fact(Timeout = 5000)]\n    public async Task Saves() { }\n}\n";

        expect(shown(await findingsOf(testTiming, { [TEST]: text }))).toEqual([`${TEST}:3`]);
    });

    it.each([
        "var provider = new FakeTimeProvider();\n        provider.Advance(TimeSpan.FromMinutes(5));",
        'var clock = new FakeTimeProvider(DateTimeOffset.Parse("2026-01-01"));',
        "await Task.Delay(TimeSpan.FromSeconds(30), timeProvider);",
        "await Task.Delay(Timeout.Infinite, token);",
        "await Task.Delay(Timeout.InfiniteTimeSpan, token);",
        "while (!saved.IsCompleted)\n        {\n            await Task.Delay(50);\n        }",
        "for (var attempt = 0; attempt < 10; attempt++) await Task.Delay(50);",
        "do\n        {\n            await Task.Delay(50);\n        } while (!saved.IsCompleted);",
        "using var cts = new CancellationTokenSource();",
        "cts.CancelAfter(TimeSpan.FromSeconds(5));",
        "using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));",
        "await reply.WaitAsync(TimeSpan.FromSeconds(10));",
        "using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5), clock);",
        "await reply.WaitAsync(TestContext.Current.CancellationToken);",
        'var text = "DateTime.Now and Thread.Sleep(5) are only words here";',
        'var json = """\n        { "at": "DateTime.UtcNow", "wait": "Task.Delay(5)" }\n        """;',
        "var due = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);",
        "using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };",
        "client.Timeout = TimeSpan.FromSeconds(30);",
        "var clock = new FakeTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));",
        "var at = new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.FromHours(2));",
        "var retry = new RetryPolicy(TimeSpan.FromSeconds(1), clock);",
        "using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1), timeProvider);",
        "CancellationTokenSource cts = new(TimeSpan.FromSeconds(30));",
        "var window = new TimeSpan(0, 5, 0);",
        "var cache = new Cache(TimeSpan.Zero);",
    ])("passes a .NET test on a fake clock, a polling loop, a ceiling against a hang or a time only in text: %s", async (body) => {
        expect(await csharp(body)).toEqual([]);
    });

    it.each([
        "var now = TimeProvider.System.GetUtcNow();",
        "var service = new NotesService(store, TimeProvider.System);",
        "services.AddSingleton(TimeProvider.System);",
        "await Task.Delay(TimeSpan.FromSeconds(1), TimeProvider.System);",
    ])("finds a .NET test on the real clock of TimeProvider.System, with the fake one as the fix: %s", async (body) => {
        const findings = await findingsOf(testTiming, { [TEST]: inTest(body) });

        expect(shown(findings)).toEqual([`${TEST}:6`]);
        expect(findings[0]?.message).toMatch(/^TimeProvider\.System is the real clock, not a FakeTimeProvider: .*new FakeTimeProvider\(\)/);
    });

    it.each([
        ["var retry = new RetryPolicy(TimeSpan.FromMilliseconds(50));", "TimeSpan.FromMilliseconds(50) handed to new RetryPolicy(…)"],
        [
            "using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(10));",
            "TimeSpan.FromMilliseconds(10) handed to new PeriodicTimer(…)",
        ],
        ["var poller = new Poller(store, interval: TimeSpan.FromSeconds(1));", "TimeSpan.FromSeconds(1) handed to new Poller(…)"],
        ["var poller = new Sync.Poller<Note>(new TimeSpan(0, 0, 1));", "new TimeSpan(0, 0, 1) handed to new Poller(…)"],
        ["Poller poller = new(TimeSpan.FromSeconds(1));", "TimeSpan.FromSeconds(1) handed to new Poller(…)"],
    ])("finds a real-time interval handed to a constructor without a TimeProvider: %s", async (body, found) => {
        const findings = await findingsOf(testTiming, { [TEST]: inTest(body) });

        expect(shown(findings)).toEqual([`${TEST}:6`]);
        expect(findings[0]?.message.startsWith(`${found} gives the code a real-time interval without a TimeProvider: `)).toBe(true);
        expect(findings[0]?.message).toContain("a ceiling against a hang stays allowed");
    });

    it("reads only the test projects, also a shared .Testing project", async () => {
        expect(await csharp("Thread.Sleep(100);", "Myapp.Server/Notes/Retry.cs")).toEqual([]);
        expect(await csharp("Thread.Sleep(100);", "tests/Myapp.Testing/Waits.cs")).toEqual(["tests/Myapp.Testing/Waits.cs:6"]);
    });

    it.each([
        ["Myapp.Web/src/notes/notes.test.ts", "const began = performance.now();"],
        ["Myapp.Web/src/notes/notes.test.ts", "expect(Date.now() - began).toBeLessThan(100);"],
        ["Myapp.Web/src/notes/notes.test.tsx", "await new Promise((resolve) => setTimeout(resolve, 50));"],
        ["Myapp.Web/src/notes/notes.test.ts", "await sleep(200);"],
        ["Myapp.Web/src/notes/notes.test.ts", 'it("saves", { timeout: 10_000 }, async () => {});'],
        ["Myapp.Web/src/notes/notes.test.ts", 'test("saves", async () => {}, { timeout: 10_000 });'],
        ["Myapp.Web/src/notes/notes.test.ts", 'describe("notes", { timeout: 5000 }, () => {});'],
        ["Myapp.Web/src/notes/notes.test.ts", 'it.each([1])("saves %d", { timeout: 5000 }, async () => {});'],
        ["Myapp.Web/src/notes/notes.test.ts", 'await vi.waitFor(save, { timeout: 3000 }); it("saves", { timeout: 5000 }, async () => {});'],
        ["Myapp.Web/src/notes/notes.test.ts", "test.setTimeout(120_000);"],
        ["Myapp.Web/src/notes/notes.test.ts", "fc.assert(property, { interruptAfterTimeLimit: 1000 });"],
        ["Myapp.Web/src/notes/notes.e2e.ts", "await page.waitForTimeout(500);"],
        ["Myapp.Web/src/notes/notes.e2e.ts", "test.setTimeout(120_000);"],
        ["Myapp.Web/e2e/app.ts", "await new Promise((resolve) => setTimeout(resolve, 1000));"],
        ["gate/consumer/consumer.spec.ts", "await page.waitForTimeout(500);"],
        ["src/button/Button.stories.tsx", "await new Promise((resolve) => setTimeout(resolve, 300));"],
    ])("finds a web test that measures, sleeps on or limits real time: %s %s", async (file, text) => {
        expect(await web(file, text)).toEqual([`${file}:1`]);
    });

    it.each([
        ["Myapp.Web/src/notes/notes.test.ts", "vi.useFakeTimers();\nsetTimeout(save, 1000);\nvi.advanceTimersByTime(1000);"],
        ["Myapp.Web/src/notes/notes.e2e.ts", "await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });"],
        ["Myapp.Web/src/notes/notes.e2e.ts", "await expect(page.getByRole('status')).toHaveText('Saved');"],
        ["Myapp.Web/e2e/playwright.config.ts", "export default { timeout: 60_000 };"],
        ["Myapp.Web/src/notes/retry.ts", "setTimeout(retry, 1000);"],
        ["Myapp.Web/src/notes/notes.test.ts", "const due = new Date('2026-01-01');"],
        ["Myapp.Web/src/notes/notes.test.ts", "await vi.waitFor(() => expect(saved).toBe(true), { timeout: 3000 });"],
        ["Myapp.Web/src/notes/notes.test.ts", "await vi.waitUntil(() => saved, { timeout: 3000, interval: 20 });"],
        ["Myapp.Web/src/notes/notes.test.ts", "await expect.poll(() => count(), { timeout: 3000 }).toBe(2);"],
        ["Myapp.Web/src/notes/notes.test.tsx", "await waitFor(() => expect(screen.getByText('Saved')).toBeVisible(), { timeout: 3000 });"],
        ["Myapp.Web/src/notes/notes.test.tsx", "await screen.findByText('Saved', {}, { timeout: 3000 });"],
        ["Myapp.Web/src/notes/notes.test.tsx", "await within(list).findAllByRole('listitem', {}, { timeout: 3000 });"],
    ])(
        "passes fake timers, Playwright's auto-waiting, a ceiling of a wait for an event, the run's config and production code: %s",
        async (file, text) => {
            expect(await web(file, text)).toEqual([]);
        },
    );

    it("passes a ceiling of a wait for an event over several lines, and still finds the test's own limit around it", async () => {
        const file = "Myapp.Web/src/notes/notes.test.ts";
        const text = [
            'it("saves", async () => {',
            "    await vi.waitFor(",
            "        () => {",
            "            expect(saved).toBe(true);",
            "        },",
            "        { timeout: 3000 },",
            "    );",
            "}, {",
            "    timeout: 10_000,",
            "});",
        ].join("\n");

        expect(await web(file, text)).toEqual([`${file}:9`]);
    });

    it("states the fix with what it found", async () => {
        const [finding] = await findingsOf(testTiming, { [TEST]: inTest("Thread.Sleep(100);") });

        expect(finding?.message).toMatch(/^Thread\.Sleep sleeps on real time: a test never measures, waits on or limits real time/);
        expect(finding?.message).toContain("FakeTimeProvider");
        expect(finding?.message).toContain("in milliseconds or in steps counted instead of them");
    });
});
