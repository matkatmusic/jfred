
import type { DiskFileState } from "./layer1_disk_walk.ts";
import type { Path } from "./structures/domain.ts";

// Do NOT rename or reorder these fields — orphan sets are symmetric, so a swap passes tests silently.
export interface Layer1Pairing {
    // Present in both lists: one file widget each, keeping the disk mtime its on-disk node needs.
    pairs: DiskFileState[];
    // Repo paths with NO on-disk counterpart — S18's "No on-disk match" bucket.
    gitOrphans: Path[];
    // Disk paths with no repo entry; each keeps its mtime for display.
    diskOrphans: DiskFileState[];
}

// ponytail: an empty bucket is an empty list, not an omitted field — S18's "buckets are omitted when empty" is the renderer reading that emptiness, so there is no optional-field dance here.
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

