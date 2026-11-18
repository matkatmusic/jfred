// One play per stop of one file: a request that arrives while a play of the file waits is dropped and its oldest start time is kept.

import type { Path } from "../../src/structures/domain.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";
import { readWalkCoverage } from "../engineV3_walk_coverage.ts";
import type { HistoryWalkerOptions, PlayOutcome, PlayRequest } from "./engineV3_tui_walk_types.ts";

export function isRepoWalkFinished(options: HistoryWalkerOptions, file: Path): boolean {
    const repoFolder = getInverseRepoFolderForFile(options.storeFolder, options.projectFolder, file);
    const coverage = readWalkCoverage(repoFolder);
    if (coverage === undefined) {
        return false;
    }
    return coverage.isFinished === true;
}

export async function requestPlayOnce(requestPlay: (request: PlayRequest) => Promise<PlayOutcome>, startAtByFileValue: Map<string, Date>, file: Path, startAt: Date): Promise<{ playOutcome: PlayOutcome; oldestStartAt: Date } | undefined> {
    const waitingStartAt = startAtByFileValue.get(file.value);
    if (waitingStartAt !== undefined) {
        const olderStartAt = waitingStartAt.getTime() <= startAt.getTime() ? waitingStartAt : startAt;
        startAtByFileValue.set(file.value, olderStartAt);
        return undefined;
    }
    startAtByFileValue.set(file.value, startAt);
    const playOutcome = await requestPlay({ file });
    const oldestStartAt = startAtByFileValue.get(file.value);
    if (oldestStartAt === undefined) {
        throw new Error(`requestPlayOnce: the waiting start time of ${file.toString()} is missing`);
    }
    startAtByFileValue.delete(file.value);
    return { playOutcome, oldestStartAt };
}
