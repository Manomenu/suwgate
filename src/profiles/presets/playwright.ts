interface Use {
    baseURL?: string;
    [key: string]: unknown;
}

interface PlaywrightConfig {
    use?: Use;
    [key: string]: unknown;
}

const ci = (): boolean => Boolean(process.env["CI"]);

export function e2eTests<Config extends PlaywrightConfig>(config: Config) {
    return {
        testDir: "../src",
        testMatch: "**/*.e2e.ts",
        workers: 1,
        retries: ci() ? 1 : 0,
        failOnFlakyTests: ci(),
        reporter: "list" as const,
        timeout: 60_000,
        projects: [{ name: "chromium", use: { browserName: "chromium" as const, viewport: { width: 1440, height: 900 } } }],
        ...config,
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
