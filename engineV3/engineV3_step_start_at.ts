// The --startAt walk: one process steps one file until its stored commits cover an instant, then prints a result line.

import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import type { FileEventType } from "./engineV3_replay_reverse_events.ts";
import type { FileStepResult } from "./engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "./engineV3_file_step_write.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { formatBeginLine, formatStepLine, type StepCliSession } from "./engineV3_step_cli.ts";
import { formatSourceText } from "./engineV3_step_replay_command.ts";
import { isInstantSpannedByWalkCoverage, writeWalkCoverage } from "./engineV3_walk_coverage.ts";

export type StepResultLine = { startAt: string; outcome: InverseStepOutcome; commitsWritten: number; position: number; commit: string; eventType: FileEventType | null; source: string | null };
export type StartAtResult = { outcome: InverseStepOutcome.AlreadyStored | InverseStepOutcome.StartAtReached | InverseStepOutcome.NoOlderChange | InverseStepOutcome.UnknownOrRoadblock; commitsWritten: number };

// The last printed line of every exit; the stop fields are filled only for a stop.
function printResultLine(session: StepCliSession, startAt: Date, result: StartAtResult, stop: FileStepResult | undefined): void {
    const storedCommits = listInverseCommits(session.repoFolder, session.fileName, false);
    const tipCommit = storedCommits[storedCommits.length - 1]!;
    const resultLine: StepResultLine = {
        startAt: startAt.toISOString(),
        outcome: result.outcome,
        commitsWritten: result.commitsWritten,
        position: tipCommit.position,
        commit: tipCommit.commitHash.toString(),
        eventType: stop?.eventType ?? null,
        source: formatSourceText(stop?.source),
    };
    console.log(JSON.stringify(resultLine));
}

export function stepUntilInstantIsSpanned(session: StepCliSession, startAt: Date, isPassingStops: boolean): StartAtResult {
    let coverage = writeWalkCoverage(session.repoFolder, session.fileName, false);
    if (isInstantSpannedByWalkCoverage(coverage, startAt)) {
        const alreadyStoredResult: StartAtResult = { outcome: InverseStepOutcome.AlreadyStored, commitsWritten: 0 };
        printResultLine(session, startAt, alreadyStoredResult, undefined);
        return alreadyStoredResult;
    }
    let stepNumber = 0;
    let commitsWritten = 0;
    while (true) {
        stepNumber += 1;
        console.log(formatBeginLine(stepNumber, session));
        const written = stepFileAndWriteCommit(session.repoFolder, session.fileName, session.step, undefined);
        console.log(formatStepLine(stepNumber, session.relativeFile, written));
        if (written.result.writtenState !== undefined) {
            commitsWritten += 1;
        }
        coverage = writeWalkCoverage(session.repoFolder, session.fileName, written.result.outcome === InverseStepOutcome.NoOlderChange);
        if (written.result.outcome === InverseStepOutcome.NoOlderChange) {
            const noOlderChangeResult: StartAtResult = { outcome: InverseStepOutcome.NoOlderChange, commitsWritten };
            printResultLine(session, startAt, noOlderChangeResult, undefined);
            return noOlderChangeResult;
        }
        if (written.result.outcome === InverseStepOutcome.UnknownOrRoadblock) {
            if (!isPassingStops) {
                const stopResult: StartAtResult = { outcome: InverseStepOutcome.UnknownOrRoadblock, commitsWritten };
                printResultLine(session, startAt, stopResult, written.result);
                return stopResult;
            }
        }
        if (isInstantSpannedByWalkCoverage(coverage, startAt)) {
            const startAtReachedResult: StartAtResult = { outcome: InverseStepOutcome.StartAtReached, commitsWritten };
            printResultLine(session, startAt, startAtReachedResult, undefined);
            return startAtReachedResult;
        }
    }
}
