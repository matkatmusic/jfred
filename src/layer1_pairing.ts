// Layer 1 pairing (task 232, spec S18 "Pairing"): join the `current file state` (task 230,
// layer1_disk_walk.ts) against the `starting repository state` (task 231, layer1_repo_tree.ts) on
// EXACT relative path — same name AND same path, each relative to its own root. A path in both
// lists is a pair and renders as one file widget; the two leftovers are S18's orphan buckets.
// Nothing is inferred and nothing is fuzzy-matched: point the two inputs at unrelated trees and
// the result is zero pairs plus two full buckets, which is the milestone's acceptance criterion
// (task 238).

import type { DiskFileState } from "./layer1_disk_walk.ts";
import type { Path } from "./structures/domain.ts";

// The three sets a Layer 1 view is built from, under the property names the wire and the webapp
// both use (user-settled 2026-07-25 — do NOT rename or invert them: the two orphan sets are mirror
// images, so a swap is invisible to the task-238 acceptance test, which only counts two buckets
// either way). Both filters preserve their input's order, so pairs and disk orphans stay in the
// disk walk's path order and git orphans in git tree order.
export interface Layer1Pairing {
    // Present in both lists: one file widget each, keeping the disk mtime its on-disk node needs.
    pairs: DiskFileState[];
    // Repo paths with NO on-disk counterpart — S18's "No on-disk match" bucket.
    gitOrphans: Path[];
    // Disk paths with NO repo entry — S18's "No repository match" bucket. Each member keeps its
    // own mtime because the bucket lists every member's timestamp.
    diskOrphans: DiskFileState[];
}

// ponytail: an empty bucket is an empty list, not an omitted field — S18's "buckets are omitted
// when empty" is the renderer reading that emptiness, so there is no optional-field dance here.
export function pairDiskFilesAgainstRepoPaths(
    currentFileState: DiskFileState[],
    startingRepositoryState: Path[],
): Layer1Pairing {
    const repoPathTexts = new Set(startingRepositoryState.map((path) => path.toString()));
    const diskPathTexts = new Set(currentFileState.map((file) => file.relativePath.toString()));
    return {
        pairs: currentFileState.filter((file) => repoPathTexts.has(file.relativePath.toString())),
        gitOrphans: startingRepositoryState.filter((path) => !diskPathTexts.has(path.toString())),
        diskOrphans: currentFileState.filter((file) => !repoPathTexts.has(file.relativePath.toString())),
    };
}
