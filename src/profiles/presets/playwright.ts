interface Use {
    baseURL?: string;
    [key: string]: unknown;
}

type ReporterDescription = readonly [string] | readonly [string, unknown];

interface PlaywrightConfig {
    use?: Use;
    reporter?: string | readonly ReporterDescription[];
    [key: string]: unknown;
}

const ci = (): boolean => Boolean(process.env["CI"]);

const GATE_REPORT = "PLAYWRIGHT_JSON_OUTPUT_FILE";

function withGateReport(reporter: string | readonly ReporterDescription[]): ReporterDescription[] {
    const listed: ReporterDescription[] =
        typeof reporter === "string" ? reporter.split(",").map((name): ReporterDescription => [name.trim()]) : [...reporter];
    const wanted = (process.env[GATE_REPORT] ?? "") !== "" && !listed.some(([name]) => name === "json");
    return wanted ? [...listed, ["json"]] : listed;
}

export function e2eTests<Config extends PlaywrightConfig>(config: Config) {
    return {
        testDir: "../src",
        testMatch: "**/*.e2e.ts",
        workers: 1,
        retries: ci() ? 1 : 0,
        failOnFlakyTests: ci(),
        timeout: 60_000,
        projects: [{ name: "chromium", use: { browserName: "chromium" as const, viewport: { width: 1440, height: 900 } } }],
        ...config,
        reporter: withGateReport(config.reporter ?? "list"),
        use: { locale: "en-US", trace: "retain-on-failure" as const, screenshot: "only-on-failure" as const, ...config.use },
    };
}

export function visualTests({ port = 6007 }: { port?: number } = {}) {
    return {
        testDir: ".",
        testMatch: "*.visual.ts",
        outputDir: "results",
        snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{arg}{ext}",
        reporter: "line" as const,
        fullyParallel: true,
        expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001 } },
        use: { baseURL: `http://127.0.0.1:${port}` },
        projects: [
            { name: "1920x1080", use: { viewport: { width: 1920, height: 1080 } } },
            { name: "3440x1440", use: { viewport: { width: 3440, height: 1440 } } },
        ],
        webServer: {
            command: `node_modules/.bin/vite preview --outDir storybook-static --host 127.0.0.1 --port ${port} --strictPort`,
            url: `http://127.0.0.1:${port}/iframe.html`,
            cwd: "..",
            reuseExistingServer: false,
        },
    };
}
