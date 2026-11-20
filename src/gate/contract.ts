export const PROFILES = ["web", "library", "dotnet", "database"] as const;

export type Profile = (typeof PROFILES)[number];

export interface Finding {
    target: string;
    message: string;
    line?: number;
}

export interface GuardException {
    guard: string;
    target: string;
    reason: string;
}

export interface GuardContext {
    root: string;
    files: readonly string[];
    profiles: readonly Profile[];
    directories: Readonly<Partial<Record<Profile, string>>>;
    exceptions: readonly GuardException[];
    settings: unknown;
    read(file: string): string;
}

export interface Guard {
    id: string;
    description: string;
    profiles: readonly Profile[] | "every";
    quick?: boolean;
    settingsSchema?: object;
    check(context: GuardContext): readonly Finding[] | Promise<readonly Finding[]>;
}

export interface StepContext {
    root: string;
    cwd: string;
    quick: boolean;
    profiles: readonly Profile[];
    directories: Readonly<Partial<Record<Profile, string>>>;
    changed(): readonly string[];
}

export interface Skip {
    skip: string;
}

export type Run = string | ((context: StepContext) => string | null | Skip);

export interface Step {
    id: string;
    title: string;
    run: Run;
    quick?: Run | true;
    profile?: Profile;
    needs?: readonly string[];
    after?: readonly string[];
    limitSeconds?: number;
}
