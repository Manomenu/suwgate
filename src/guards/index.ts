import type { Guard } from "../gate/contract.ts";
import { commentGuards } from "./comments/index.ts";
import { criteriaGuards } from "./criteria/index.ts";
import { databaseGuards } from "./database/index.ts";
import { dotnetGuards } from "./dotnet/index.ts";
import { repositoryGuards } from "./repository/index.ts";

export { SHARED_RULES, writeSharedRules } from "./repository/stackRules.ts";

export const guards: readonly Guard[] = [...repositoryGuards, ...commentGuards, ...criteriaGuards, ...dotnetGuards, ...databaseGuards];
