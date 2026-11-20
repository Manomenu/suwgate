import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface KnipConfig {
    ignore?: string[];
    ignoreDependencies?: string[];
    playwright?: { config?: string[] };
    [key: string]: unknown;
}

const STEP_TOOLS = ["publint", "@arethetypeswrong/cli", "openapi-typescript"];

const GENERATED = ["src/api/openapi.d.ts"];

const PLAYWRIGHT_CONFIGS = ["e2e/playwright.config.ts", "visual/playwright.config.ts", "gate/consumer/playwright.config.ts"];

function dependencies(directory: string): string[] {
    try {
        const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as Record<string, unknown>;
        return ["dependencies", "devDependencies"].flatMap((field) => {
            const listed = manifest[field];
            return listed !== null && typeof listed === "object" ? Object.keys(listed) : [];
        });
    } catch {
        return [];
    }
}

export function knip(config: KnipConfig = {}, directory = process.cwd()): KnipConfig {
    const present = (file: string) => existsSync(path.join(directory, file));
    const installed = dependencies(directory);
    const playwrightConfigs = [...PLAYWRIGHT_CONFIGS.filter(present), ...(config.playwright?.config ?? [])];
    return {
        ...config,
        ignore: [...GENERATED.filter(present), ...(config.ignore ?? [])],
        ignoreDependencies: [...STEP_TOOLS.filter((tool) => installed.includes(tool)), ...(config.ignoreDependencies ?? [])],
        ...(playwrightConfigs.length === 0 ? {} : { playwright: { ...config.playwright, config: playwrightConfigs } }),
    };
}

export default knip();
