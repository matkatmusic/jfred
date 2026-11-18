// The --auto walk of the terminal UI: walks every file back to the oldest instant, with no screen.

import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus } from "../../src/structures/vocabulary.ts";
import type { FileRunState } from "./engineV3_tui_walk_state.ts";
import type { HistoryWalker, StepPool } from "./engineV3_tui_walk_types.ts";

export type AutoWalkOptions = {
    oldestInstant: Date;
    files: Path[];
    walker: HistoryWalker;
    pool: StepPool;
    getRunState: (file: Path) => FileRunState;
    isFileWalkFinished: (file: Path) => boolean;
};

function listFilesNeedingWork(options: AutoWalkOptions): Path[] {
    const filesNeedingWork: Path[] = [];
    for (const file of options.files) {
        const runState = options.getRunState(file);
        if (runState.status === FileWalkStatus.Stopped) {
            continue;
        }
        if (runState.status === FileWalkStatus.Crashed) {
            continue;
        }
        if (runState.status === FileWalkStatus.Idle) {
            if (options.isFileWalkFinished(file)) {
                continue;
            }
        }
        filesNeedingWork.push(file);
    }
    return filesNeedingWork;
}

export async function runAutoWalk(options: AutoWalkOptions): Promise<void> {
    while (true) {
        const filesNeedingWork = listFilesNeedingWork(options);
        if (filesNeedingWork.length === 0) {
            return;
        }
        let wasWalkRequested = false;
        for (const file of filesNeedingWork) {
            const isAlreadySpanned = options.walker.walkHistoryTo(options.oldestInstant, file, true);
            if (!isAlreadySpanned) {
                wasWalkRequested = true;
            }
        }
        await options.pool.waitUntilIdle();
        if (!wasWalkRequested) {
            return;
        }
    }
}
