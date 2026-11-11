// Picks the root folder a Write or Edit path belongs to: the state folder, else /private/tmp or /tmp.

import { Path } from "../src/structures/domain.ts";
import { convertToProjectRelativePath } from "../src/layer1_snapshot_wire.ts";

const TEMP_ROOT_FOLDERS: Path[] = [new Path("/private/tmp"), new Path("/tmp")];

// The docker run mounts an empty folder here, so the recorded memory Writes fill it in recorded order.
const CLAUDE_MEMORY_FOLDER_PATTERN = /^\/Users\/[^/]+\/\.claude\/projects\/[^/]+\/memory\//;

export function findReplayRoot(state: Path, absolutePath: Path): Path | undefined {
  const candidateRoots = [state, ...TEMP_ROOT_FOLDERS];
  for (const candidateRoot of candidateRoots) {
    const relativePath = convertToProjectRelativePath(candidateRoot, absolutePath.toString());
    if (relativePath !== undefined) {
      return candidateRoot;
    }
  }
  const memoryMatch = absolutePath.toString().match(CLAUDE_MEMORY_FOLDER_PATTERN);
  if (memoryMatch !== null) {
    return new Path(memoryMatch[0].slice(0, -1));
  }
  return undefined;
}

export function getReplayRoot(state: Path, absolutePath: Path): Path {
  const root = findReplayRoot(state, absolutePath);
  if (root === undefined) {
    throw new Error(`getReplayRoot: ${absolutePath.toString()} is outside the state folder ${state.toString()} and outside /private/tmp and /tmp`);
  }
  return root;
}
