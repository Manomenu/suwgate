import type { Exec, ExecOptions, Io } from "./process.ts";
import { resolveSettings, type DevSettings } from "./settings.ts";

export function settingsOf(
    raw: unknown = { name: "myapp", server: { project: "Myapp.Server" } },
    directories: Record<string, unknown> = { web: "Myapp.Web" },
): DevSettings {
    return resolveSettings(raw, directories, "/repo");
}

export interface Call {
    argv: readonly string[];
    options: ExecOptions | undefined;
}

export function fakeExec(answer: (argv: readonly string[]) => { status?: number; stdout?: string } = () => ({})): {
    exec: Exec;
    calls: Call[];
} {
    const calls: Call[] = [];
    const exec: Exec = (argv, options) => {
        calls.push({ argv, options });
        const { status = 0, stdout = "" } = answer(argv);
        return Promise.resolve({ status, stdout });
    };
    return { exec, calls };
}

export function recordingIo(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (text) => out.push(text), err: (text) => err.push(text) }, out, err };
}
