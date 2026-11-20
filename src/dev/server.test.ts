import { describe, expect, it } from "vitest";

import { Failure } from "./process.ts";
import { MAX_PAUSE_SECONDS, nextPause, serverArgv, serverScript } from "./server.ts";
import { settingsOf } from "./testing.ts";

describe("dev server", () => {
    it("loads .env, then runs dotnet watch on the project with the arguments", () => {
        expect(serverScript("Myapp.Server")).toBe(
            `set -a; if [ -f .env ]; then source .env; fi; set +a; exec dotnet watch --non-interactive --quiet --project 'Myapp.Server' run "$@" 2>&1`,
        );
        expect(serverArgv(settingsOf(), ["--no-build"]).slice(0, 2)).toEqual(["bash", "-c"]);
        expect(serverArgv(settingsOf(), ["--no-build"]).at(-1)).toBe("--no-build");
    });

    it("quotes a project folder with a quote in it", () => {
        expect(serverScript("it's")).toContain(`--project 'it'"'"'s'`);
    });

    it("needs a server project", () => {
        expect(() => serverArgv(settingsOf({ name: "x" }, {}), [])).toThrow(Failure);
    });

    it("doubles the pause while it keeps failing fast, up to a minute, and starts over after a long run", () => {
        expect(nextPause(1, 5)).toBe(2);
        expect(nextPause(2, 5)).toBe(4);
        expect(nextPause(40, 5)).toBe(MAX_PAUSE_SECONDS);
        expect(nextPause(MAX_PAUSE_SECONDS, 5)).toBe(MAX_PAUSE_SECONDS);
        expect(nextPause(32, 60)).toBe(2);
    });
});
