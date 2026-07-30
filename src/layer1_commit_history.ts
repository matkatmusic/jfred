// Per-pair commit history: commits touching one path, widened onto the ms axis.
//
// Reuses listCommitsTouchingFile; no --follow until S6 rename tracking lands.

import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { listCommitsTouchingFile } from "./layered_git_beacons.ts";
import { widenEpochSecondsToInstant } from "./layered_instants.ts";
import type { Instant } from "./layered_types.ts";
import type { Path } from "./structures/domain.ts";
import { CommitTimeSource } from "../webapp/layer1-wire.ts";

// One commit node of a pair's history.
export interface CommitHistoryNode {
    hash: string;
    instant: Instant;
}

// Returns oldest-first commits touching a path; ref must match the tree's ref (task 235).
export function listPairCommitHistory(
    repoDir: Path,
    repoRelativePath: Path,
    ref: string = ACTIVE_BRANCH_REF,
    timeSource: CommitTimeSource = CommitTimeSource.committer,
): CommitHistoryNode[] {
    return listCommitsTouchingFile(repoDir, repoRelativePath, ref).map((touch) => {
        const seconds = timeSource === CommitTimeSource.author ? touch.authorEpochSeconds : touch.committerEpochSeconds;
        return { hash: touch.hash, instant: widenEpochSecondsToInstant(seconds) };
    });
}

