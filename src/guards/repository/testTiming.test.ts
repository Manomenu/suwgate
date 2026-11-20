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
        "var start = TimeProvider.System.GetTimestamp();",
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
    ])("passes a .NET test on a fake clock, a polling loop, a ceiling against a hang or a time only in text: %s", async (body) => {
        expect(await csharp(body)).toEqual([]);
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
    ])("passes fake timers, Playwright's auto-waiting, the run's config and production code: %s", async (file, text) => {
        expect(await web(file, text)).toEqual([]);
    });

    it("states the fix with what it found", async () => {
        const [finding] = await findingsOf(testTiming, { [TEST]: inTest("Thread.Sleep(100);") });

        expect(finding?.message).toMatch(/^Thread\.Sleep sleeps on real time: a test never measures, waits on or limits real time/);
        expect(finding?.message).toContain("FakeTimeProvider");
        expect(finding?.message).toContain("in milliseconds or in steps counted instead of them");
    });
});
