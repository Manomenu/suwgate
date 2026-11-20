import type { Guard } from "../../gate/contract.ts";
import { connectionHost } from "./connectionHost.ts";
import { migrationsUnchanged } from "./migrationsUnchanged.ts";

export const databaseGuards: readonly Guard[] = [connectionHost, migrationsUnchanged];
