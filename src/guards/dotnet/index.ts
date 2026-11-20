import type { Guard } from "../../gate/contract.ts";
import { appsettingsBound } from "./appsettingsBound.ts";
import { bannedNugetPackages } from "./bannedNugetPackages.ts";
import { unusedNugetVersions } from "./unusedNugetVersions.ts";

export const dotnetGuards: readonly Guard[] = [bannedNugetPackages, unusedNugetVersions, appsettingsBound];
