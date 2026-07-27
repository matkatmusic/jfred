// Layer 1 per-pair commit history (task 233, spec S18 "Per-pair history"): the commits that
// touched ONE pair's path, each as a hash plus its committer instant. A commit that did not touch
// the file contributes nothing — there is no empty node for it. No `--follow`, so a renamed file
// legitimately shows the shorter history until S6 lands rename tracking.
//
// The git-log read itself is layered_git_beacons.ts's `listCommitsTouchingFile`, reused rather
// than written a second time; all this module adds is dropping the blob read (Layer 1 wants the
// node, not the bytes — and unlike a Layer-2 beacon, a commit that DELETED the file still counts
// as a touch) and widening the chosen stamp's seconds onto the shared ms axis. Committer time is the
// default (one machine, one clock — hpp Q7); task 282 lets a Layer 1 view ask for author time
// instead, and since both stamps come back from the one git log the choice costs no extra spawn.

import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { listCommitsTouchingFile } from "./layered_git_beacons.ts";
import { widenEpochSecondsToInstant } from "./layered_instants.ts";
import type { Instant } from "./layered_types.ts";
import type { Path } from "./structures/domain.ts";
import { CommitTimeSource } from "./structures/vocabulary_view.ts";

// One commit node of a pair's history.
export interface CommitHistoryNode {
    hash: string;
    instant: Instant;
}

// The commits touching `repoRelativePath` in `repoDir` reachable from `ref` (default: the active
// branch), OLDEST first (commit order). Empty when the file was never committed; a genuinely
// unreadable repo or a bad ref is caught loudly upstream by readRepoTreeAtRef (task 231), so quiet
// emptiness here cannot hide a mistyped input. `ref` must be the SAME ref the repo tree was read
// at (task 235) — otherwise a path tracked at that ref but absent from HEAD gets no ladder.
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
