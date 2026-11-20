import type { Guard } from "../../gate/contract.ts";
import { criteriaKinds } from "./criteriaKinds.ts";

export const criteriaGuards: readonly Guard[] = [criteriaKinds];
