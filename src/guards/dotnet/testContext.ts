import type { GuardContext } from "../../gate/contract.ts";

export function contextOf(files: Readonly<Record<string, string>>, extra: Partial<GuardContext> = {}): GuardContext {
    return {
        root: "/",
        files: Object.keys(files),
        profiles: ["dotnet"],
        directories: {},
        exceptions: [],
        settings: undefined,
        read: (file) => files[file] ?? "",
        ...extra,
    };
}
