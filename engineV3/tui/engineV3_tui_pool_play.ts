// The play request of the step pool: walk every needed file to its end, then run the play child alone.

import type { Path } from "../../src/structures/domain.ts";
import { PlayOutcomeKind } from "../../src/structures/vocabulary.ts";
import type { PlayOutcome, PlayRequest, StepPoolOptions, StepRequest } from "./engineV3_tui_walk_types.ts";

export type PlayContext = Pick<StepPoolOptions, "isFileSteppable" | "isFileWalkFinished" | "spawnPlayProcess"> & {
    requestWalk: (request: StepRequest, isVisible: boolean) => void;
    waitForConsent: () => Promise<void>;
    waitUntilIdle: () => Promise<void>;
    isIdle: () => boolean;
    setPlayRunning: (isRunning: boolean) => void;
    releaseQueue: () => void;
};

export function listRunningFiles(runningRequestByFileValue: Map<string, StepRequest>): Path[] {
    return [...runningRequestByFileValue.values()].map((request) => request.file);
}

function makeRefusedOutcome(reasonText: string): PlayOutcome {
    return { kind: PlayOutcomeKind.ReplayRefused, reasonText };
}

function makeNothingToReplayOutcome(): PlayOutcome {
    return { kind: PlayOutcomeKind.Replayed, reasonText: undefined };
}

function findUnfinishedFile(files: Path[], context: PlayContext): Path | undefined {
    return files.find((file) => !context.isFileWalkFinished(file));
}

export async function runPlayRequest(request: PlayRequest, walkToEndFiles: Path[], context: PlayContext): Promise<PlayOutcome> {
    await context.waitForConsent();
    if (context.isFileWalkFinished(request.file)) {
        return makeNothingToReplayOutcome();
    }
    const unsteppableFile = walkToEndFiles.find((file) => !context.isFileSteppable(file));
    if (unsteppableFile !== undefined) {
        return makeRefusedOutcome(`the replay needs ${unsteppableFile.toString()}, which the step program cannot walk`);
    }
    for (const file of walkToEndFiles) {
        if (!context.isFileWalkFinished(file)) {
            context.requestWalk({ file, startAt: new Date(0), isPassingStops: true }, true);
        }
    }
    do {
        await context.waitUntilIdle();
    } while (!context.isIdle());
    if (context.isFileWalkFinished(request.file)) {
        return makeNothingToReplayOutcome();
    }
    const unfinishedFile = findUnfinishedFile(walkToEndFiles, context);
    if (unfinishedFile !== undefined) {
        return makeRefusedOutcome(`the repo of ${unfinishedFile.toString()} is not walked to its end: unknown`);
    }
    context.setPlayRunning(true);
    const playOutcome = await context.spawnPlayProcess(request);
    context.setPlayRunning(false);
    context.releaseQueue();
    return playOutcome;
}
