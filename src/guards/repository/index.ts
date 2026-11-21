import type { Guard } from "../../gate/contract.ts";
import { agentsFile } from "./agentsFile.ts";
import { agentsShared } from "./stackRules.ts";
import { bannedNpmPackages } from "./bannedNpmPackages.ts";
import { composePorts } from "./composePorts.ts";
import { configContents } from "./configContents.ts";
import { dependencyDirection } from "./dependencyDirection.ts";
import { docsPaths } from "./docsPaths.ts";
import { forbiddenNames } from "./forbiddenNames.ts";
import { hooks } from "./hooks.ts";
import { humanDocs } from "./humanDocs.ts";
import { imagePins } from "./imagePins.ts";
import { justModules } from "./justModules.ts";
import { noRawColors } from "./noRawColors.ts";
import { repositoryLayout } from "./repositoryLayout.ts";
import { requiredFiles } from "./requiredFiles.ts";
import { scriptsCalled } from "./scriptsCalled.ts";
import { scriptsHelp } from "./scriptsHelp.ts";
import { suwfrontkitWiring } from "./suwfrontkitWiring.ts";
import { testTiming } from "./testTiming.ts";
import { vsCodeSettings } from "./vsCodeSettings.ts";

export const repositoryGuards: readonly Guard[] = [
    requiredFiles,
    configContents,
    agentsFile,
    agentsShared,
    docsPaths,
    forbiddenNames,
    repositoryLayout,
    scriptsCalled,
    scriptsHelp,
    justModules,
    imagePins,
    composePorts,
    vsCodeSettings,
    bannedNpmPackages,
    noRawColors,
    dependencyDirection,
    hooks,
    suwfrontkitWiring,
    testTiming,
    humanDocs,
];
