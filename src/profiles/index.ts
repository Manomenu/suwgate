import { PROFILES, type Profile, type Step } from "../gate/contract.ts";
import { contractSteps } from "./contract.ts";
import { databaseSteps } from "./database.ts";
import { dotnetSteps } from "./dotnet.ts";
import { everyRepositorySteps } from "./everyRepository.ts";
import { librarySteps } from "./library.ts";
import { nodeSteps } from "./node.ts";
import { webSteps } from "./web.ts";

export { discoverApiIn } from "./contract.ts";
export { dotnetGuards } from "./dotnetGuards.ts";
export { verdict } from "./verdict.ts";

const BY_PROFILE: Readonly<Record<Profile, readonly Step[]>> = {
    web: [...nodeSteps("web"), ...webSteps, ...contractSteps],
    library: [...nodeSteps("library"), ...librarySteps],
    dotnet: [...dotnetSteps, ...contractSteps],
    database: databaseSteps,
};

export function stepsFor(profiles: readonly Profile[]): Step[] {
    const steps = [
        ...PROFILES.filter((profile) => profiles.includes(profile)).flatMap((profile) => BY_PROFILE[profile]),
        ...everyRepositorySteps,
    ];
    return steps.filter((step, index) => steps.findIndex((other) => other.id === step.id) === index);
}
