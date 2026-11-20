import { describe, expect, it } from "vitest";

import { UsageError } from "./process.ts";
import { buildSession, paneCommands, parseTmux, runTmux, sessionName, type TmuxEnvironment } from "./tmux.ts";
import { fakeExec, recordingIo, settingsOf, type Call } from "./testing.ts";

const SELF = "'node' '/x/cli.ts'";

function environment(
    answer: (argv: readonly string[]) => { status?: number; stdout?: string },
    env: Record<string, string> = {},
): { environment: TmuxEnvironment; calls: Call[]; out: string[] } {
    const { exec, calls } = fakeExec(answer);
    const { io, out } = recordingIo();
    return { environment: { settings: settingsOf(), exec, io, env, self: SELF }, calls, out };
}

function tmuxCalls(calls: readonly Call[]): string[][] {
    return calls.filter((call) => call.argv[0] === "tmux").map((call) => call.argv.slice(1));
}

function panes(argv: readonly string[]): { stdout?: string } {
    return argv[1] === "new-session" ? { stdout: "%0" } : argv[1] === "split-window" ? { stdout: argv[2] === "-h" ? "%1" : "%2" } : {};
}

describe("dev tmux: arguments", () => {
    it.each([
        [["start"], { kind: "start", restart: false }],
        [["start", "--restart"], { kind: "start", restart: true }],
        [["stop"], { kind: "stop" }],
    ])("reads %j", (args, expected) => {
        expect(parseTmux(args)).toEqual(expected);
    });

    it.each([[[]], [["start", "--now"]], [["stop", "--restart"]], [["restart"]]])("refuses %j", (args) => {
        expect(() => parseTmux(args)).toThrow(UsageError);
    });
});

describe("dev tmux: the layout", () => {
    it("names the session after the app", () => {
        expect(sessionName(settingsOf())).toBe("myapp-dev");
    });

    it("starts the database, then the server in its pane, and installs then runs the web app", () => {
        expect(paneCommands(settingsOf(), SELF)).toEqual({
            server: `${SELF} dev db up && ${SELF} dev server`,
            web: "cd 'Myapp.Web' && { [ -d node_modules ] || pnpm install; } && pnpm dev",
        });
    });

    it("builds a shell, a server and a web pane, titled with their ports", async () => {
        const { environment: env, calls } = environment(panes);
        await buildSession(env);
        const commands = tmuxCalls(calls);
        expect(commands[0]).toEqual([
            "new-session",
            "-d",
            "-s",
            "myapp-dev",
            "-c",
            "/repo",
            "-x",
            "220",
            "-y",
            "50",
            "-P",
            "-F",
            "#{pane_id}",
        ]);
        expect(commands).toContainEqual(["split-window", "-v", "-t", "%1", "-c", "/repo", "-P", "-F", "#{pane_id}"]);
        expect(commands).toContainEqual(["select-pane", "-t", "%1", "-T", "server: (6300)"]);
        expect(commands).toContainEqual(["select-pane", "-t", "%2", "-T", "web: (3300)"]);
        expect(commands).toContainEqual(["send-keys", "-t", "%1", `${SELF} dev db up && ${SELF} dev server`, "Enter"]);
        expect(commands.at(-1)).toEqual(["select-pane", "-t", "%0"]);
    });
});

describe("dev tmux: start and stop", () => {
    it("builds the session and attaches when none runs", async () => {
        const { environment: env, calls } = environment((argv) => (argv[1] === "has-session" ? { status: 1 } : panes(argv)));
        expect(await runTmux({ kind: "start", restart: false }, env)).toBe(0);
        expect(tmuxCalls(calls).some((call) => call[0] === "new-session")).toBe(true);
        expect(calls.at(-1)?.argv).toEqual(["env", "-u", "TMUX", "tmux", "attach-session", "-t", "myapp-dev"]);
    });

    it("only attaches to a session that runs", async () => {
        const { environment: env, calls } = environment(() => ({}));
        await runTmux({ kind: "start", restart: false }, env);
        expect(tmuxCalls(calls).some((call) => call[0] === "new-session")).toBe(false);
        expect(calls.at(-1)?.argv[0]).toBe("env");
    });

    it("stops there with TMUX_DEV_NO_ATTACH=1", async () => {
        const { environment: env, calls } = environment(() => ({}), { TMUX_DEV_NO_ATTACH: "1" });
        await runTmux({ kind: "start", restart: false }, env);
        expect(calls.some((call) => call.argv.includes("attach-session"))).toBe(false);
    });

    it("switches the client instead of nesting when this terminal is a pane", async () => {
        const { environment: env, calls } = environment(
            (argv) =>
                argv[0] === "tty" ? { stdout: "/dev/pts/3\n" } : argv[1] === "list-panes" ? { stdout: "/dev/pts/1\n/dev/pts/3\n" } : {},
            { TMUX: "/tmp/tmux-1/default,1,0" },
        );
        await runTmux({ kind: "start", restart: false }, env);
        expect(calls.at(-1)?.argv).toEqual(["tmux", "switch-client", "-t", "myapp-dev"]);
    });

    it("does not trust TMUX alone: an editor's terminal is not a pane", async () => {
        const { environment: env, calls } = environment(
            (argv) => (argv[0] === "tty" ? { stdout: "/dev/pts/9" } : argv[1] === "list-panes" ? { stdout: "/dev/pts/1" } : {}),
            { TMUX: "/tmp/tmux-1/default,1,0" },
        );
        await runTmux({ kind: "start", restart: false }, env);
        expect(calls.at(-1)?.argv[0]).toBe("env");
    });

    it("refuses --restart from inside the session", async () => {
        const { environment: env } = environment(
            (argv) =>
                argv[0] === "tty"
                    ? { stdout: "/dev/pts/3" }
                    : argv[1] === "list-panes"
                      ? { stdout: "/dev/pts/3" }
                      : argv[1] === "display-message"
                        ? { stdout: "myapp-dev" }
                        : {},
            { TMUX: "x" },
        );
        await expect(runTmux({ kind: "start", restart: true }, env)).rejects.toThrow("Run --restart from outside the myapp-dev session");
    });

    it("kills the old session on --restart from outside, then builds a new one", async () => {
        let killed = false;
        const { environment: env, calls } = environment(
            (argv) => {
                if (argv[1] === "kill-session") killed = true;
                if (argv[1] === "has-session") return { status: killed ? 1 : 0 };
                return panes(argv);
            },
            { TMUX_DEV_NO_ATTACH: "1" },
        );
        await runTmux({ kind: "start", restart: true }, env);
        const names = tmuxCalls(calls).map((call) => call[0]);
        expect(names.indexOf("kill-session")).toBeLessThan(names.indexOf("new-session"));
    });

    it("says so when stop finds no session, and kills the one that runs", async () => {
        const none = environment(() => ({ status: 1 }));
        none.environment.exec = fakeExec((argv) => (argv[1] === "-V" ? {} : { status: 1 })).exec;
        expect(await runTmux({ kind: "stop" }, none.environment)).toBe(0);
        expect(none.out).toEqual(["No myapp-dev session is running."]);

        const some = environment(() => ({}));
        await runTmux({ kind: "stop" }, some.environment);
        expect(some.out).toEqual(["Stopping the myapp-dev session."]);
        expect(tmuxCalls(some.calls)).toContainEqual(["kill-session", "-t", "=myapp-dev"]);
    });

    it("says how to install tmux when it is missing", async () => {
        const { environment: env } = environment(() => ({ status: 127 }));
        await expect(runTmux({ kind: "stop" }, env)).rejects.toThrow("sudo dnf install tmux");
    });
});
