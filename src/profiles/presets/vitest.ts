interface UnitOptions {
    extends?: string;
    environment?: string;
    globals?: boolean;
    include?: string[];
}

interface StoryOptions<Plugin, Provider> {
    extends?: string;
    plugin: Plugin;
    provider: Provider;
}

export function unitTests({ extends: base, ...test }: UnitOptions = {}) {
    return {
        ...(base === undefined ? {} : { extends: base }),
        test: { name: "unit", include: ["src/**/*.test.{ts,tsx}"], ...test },
    };
}

export function storyTests<Plugin, Provider>({ extends: base, plugin, provider }: StoryOptions<Plugin, Provider>) {
    return {
        ...(base === undefined ? {} : { extends: base }),
        plugins: [plugin],
        test: {
            name: "stories",
            browser: { enabled: true, provider, headless: true, instances: [{ browser: "chromium" as const }] },
        },
    };
}
