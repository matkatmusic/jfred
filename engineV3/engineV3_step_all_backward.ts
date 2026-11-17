// The b walk of --step-all: steps back through the position history and checks every step against the stored commits.

import type { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { moveBackwardInPositionHistory } from "./engineV3_step_cli.ts";

export function checkBackwardWalk(positionHistory: number[], repoFolder: Path, fileName: string): { stepsBackward: number; failures: string[] } {
    const failures: string[] = [];
    const storedPositions = listInverseCommits(repoFolder, fileName, false).map((storedCommit) => storedCommit.position);
    if (positionHistory.join(",") !== storedPositions.join(",")) {
        failures.push(`the position history [${positionHistory.join(",")}] differs from the stored positions [${storedPositions.join(",")}]`);
    }
    const walkedHistory = [...positionHistory];
    let stepsBackward = 0;
    let outcome: InverseStepOutcome | undefined;
    let position = walkedHistory[walkedHistory.length - 1]!;
    while (outcome !== InverseStepOutcome.NoNewerChange) {
        const previousPosition = walkedHistory[walkedHistory.length - 1]!;
        const backwardStep = moveBackwardInPositionHistory(walkedHistory, repoFolder, fileName);
        outcome = backwardStep.outcome;
        position = backwardStep.position;
        if (outcome === InverseStepOutcome.MovedBack) {
            stepsBackward += 1;
            if (position >= previousPosition) {
                failures.push(`b step ${stepsBackward}: position ${position} is not lower than ${previousPosition}`);
            }
            if (backwardStep.storedCommit === undefined) {
                failures.push(`b step ${stepsBackward}: no stored commit at position ${position}`);
            } else {
                if (backwardStep.storedCommit.position !== position) {
                    failures.push(`b step ${stepsBackward}: the stored commit has position ${backwardStep.storedCommit.position}, not ${position}`);
                }
            }
        }
    }
    if (position !== 0) {
        failures.push(`the last position of the b walk is ${position}, not 0`);
    }
    if (stepsBackward !== positionHistory.length - 1) {
        failures.push(`the b walk took ${stepsBackward} steps, not ${positionHistory.length - 1}`);
    }
    return { stepsBackward, failures };
}
