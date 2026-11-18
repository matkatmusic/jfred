// The small helpers of the history walker: the coverage check and the run state writes.

import type { Path } from "../../src/structures/domain.ts";
import type { FileWalkStatus } from "../../src/structures/vocabulary.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";
import { isInstantSpannedByWalkCoverage, readWalkCoverage } from "../engineV3_walk_coverage.ts";
import { getFileRunState, setFileRunState, type FileRunState } from "./engineV3_tui_walk_state.ts";
import type { HistoryWalkerOptions } from "./engineV3_tui_walk_types.ts";

export function isRepoSpanningInstant(options: HistoryWalkerOptions, file: Path, instant: Date): boolean {
    const repoFolder = getInverseRepoFolderForFile(options.storeFolder, options.projectFolder, file);
    const coverage = readWalkCoverage(repoFolder);
    if (coverage === undefined) {
        return false;
    }
    return isInstantSpannedByWalkCoverage(coverage, instant);
}

export function writeRunState(options: HistoryWalkerOptions, file: Path, runState: FileRunState): void {
    setFileRunState(options.walkState, file, runState);
    options.onStatusChange(file, runState);
}

export function writeStatus(options: HistoryWalkerOptions, file: Path, status: FileWalkStatus, reasonText: string | undefined): void {
    const previousRunState = getFileRunState(options.walkState, file);
    writeRunState(options, file, { status, reasonText, failedReplayCount: previousRunState.failedReplayCount });
}
