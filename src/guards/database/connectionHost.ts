import type { Finding, Guard } from "../../gate/contract.ts";

const SCANNED = new Set([".cs", ".json", ".sh", ".ts", ".yaml", ".yml", ".md"]);
const GENERATED = ["pnpm-lock.yaml", "packages.lock.json", "package-lock.json"];
const LOCALHOST_HOST = new RegExp(String.raw`\bHost\s*=\s*local` + "host\\b", "i");

function scanned(file: string): boolean {
    const name = file.slice(file.lastIndexOf("/") + 1);
    return SCANNED.has(name.slice(name.lastIndexOf("."))) && !GENERATED.includes(name);
}

export const connectionHost: Guard = {
    id: "connection-host",
    description: "No connection string names the host by its name instead of its address (write Host=127.0.0.1)",
    profiles: ["database"],
    check(context) {
        const findings: Finding[] = [];
        for (const file of context.files.filter(scanned)) {
            context
                .read(file)
                .split("\n")
                .forEach((text, index) => {
                    if (LOCALHOST_HOST.test(text)) {
                        findings.push({
                            target: file,
                            line: index + 1,
                            message: "write Host=127.0.0.1: on Windows the name tries IPv6 first and every new connection waits seconds",
                        });
                    }
                });
        }
        return findings;
    },
};
