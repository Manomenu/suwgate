import { PROFILES, type Profile, type Step } from "../gate/contract.ts";
import { dotnetSteps } from "./dotnet.ts";
import { everyRepositorySteps } from "./everyRepository.ts";
import { librarySteps } from "./library.ts";
import { nodeSteps } from "./node.ts";

const BY_PROFILE: Readonly<Record<Profile, readonly Step[]>> = {
    web: nodeSteps("web"),
    library: [...nodeSteps("library"), ...librarySteps],
    dotnet: dotnetSteps,
    database: [],
};

export function stepsFor(profiles: readonly Profile[]): Step[] {
    const steps = [
        ...PROFILES.filter((profile) => profiles.includes(profile)).flatMap((profile) => BY_PROFILE[profile]),
        ...everyRepositorySteps,
    ];
    return steps.filter((step, index) => steps.findIndex((other) => other.id === step.id) === index);
}
