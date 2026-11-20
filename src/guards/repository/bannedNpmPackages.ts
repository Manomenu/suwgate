import type { Guard } from "../../gate/contract.ts";
import { npmDependencies } from "./packageManifests.ts";

const KIT_COMPONENTS = "build it from the components of @maniumek/suwfrontkit and Tailwind utilities";
const TOKENS = "style with Tailwind utilities and the theme's tokens";

const BANNED_NPM_PACKAGES: Readonly<Record<string, string>> = {
    "@mantine/": KIT_COMPONENTS,
    "@mui/": KIT_COMPONENTS,
    "@chakra-ui/": KIT_COMPONENTS,
    "@emotion/": TOKENS,
    "styled-components": TOKENS,
    classnames: "use cn() of @maniumek/suwfrontkit",
    lodash: "use the standard library",
    "lodash-es": "use the standard library",
    moment: "use Intl and Date",
    jquery: "use React and the DOM",
};

interface Settings {
    packages?: Record<string, string>;
}

function bannedBy(name: string, banned: Readonly<Record<string, string>>): string | undefined {
    const match = Object.keys(banned).find((entry) => name === entry || (entry.endsWith("/") && name.startsWith(entry)));
    return match === undefined ? undefined : banned[match];
}

export const bannedNpmPackages: Guard = {
    id: "banned-npm-packages",
    description:
        "No package.json depends on a banned package (component kits, CSS-in-JS, lodash, moment, jQuery, classnames, and what settings add)",
    profiles: ["web", "library"],
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            packages: {
                type: "object",
                description: "More banned packages: the name (a scope ends with /) and what to use instead.",
                additionalProperties: { type: "string", minLength: 1 },
            },
        },
    },
    check(context) {
        const settings = (context.settings ?? {}) as Settings;
        const banned = { ...BANNED_NPM_PACKAGES, ...(settings.packages ?? {}) };
        return npmDependencies(context).flatMap(({ manifest, name, line }) => {
            const instead = bannedBy(name, banned);
            return instead === undefined ? [] : [{ target: name, line, message: `${manifest} depends on it: remove it and ${instead}` }];
        });
    },
};
