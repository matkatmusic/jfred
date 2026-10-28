
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

// ponytail: an empty bucket is an empty list; the renderer omits empty buckets (S18).
export function findDiskRepoPairing(
  currentFileState: DiskFileState[],
  startingRepositoryState: Path[],
): Layer1Pairing {
  const repoPathTexts = new Set<string>();
  for (const path of startingRepositoryState) {
    repoPathTexts.add(path.toString());
  }
  const diskPathTexts = new Set<string>();
  const pairs: DiskFileState[] = [];
  const diskOrphans: DiskFileState[] = [];
  for (const file of currentFileState) {
    const diskPathText = file.relativePath.toString();
    diskPathTexts.add(diskPathText);
    const isPaired = repoPathTexts.has(diskPathText);
    if (isPaired) {
      pairs.push(file);
    }
    else {
      diskOrphans.push(file);
    }
  }
  const gitOrphans: Path[] = [];
  for (const path of startingRepositoryState) {
    const isOrphan = !diskPathTexts.has(path.toString());
    if (isOrphan) {
      gitOrphans.push(path);
    }
  }
  return { pairs, gitOrphans, diskOrphans };
}

