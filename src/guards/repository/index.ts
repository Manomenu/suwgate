import type { Guard } from "../../gate/contract.ts";
import { requiredFiles } from "./requiredFiles.ts";

export const repositoryGuards: readonly Guard[] = [requiredFiles];
