// Picks the root folder a Write or Edit path belongs to: the state folder, else /private/tmp or /tmp.

import { Path } from "../src/structures/domain.ts";
import { convertToProjectRelativePath } from "../src/layer1_snapshot_wire.ts";

const TEMP_ROOT_FOLDERS: Path[] = [new Path("/private/tmp"), new Path("/tmp")];

export function findReplayRoot(state: Path, absolutePath: Path): Path | undefined {
  const candidateRoots = [state, ...TEMP_ROOT_FOLDERS];
  for (const candidateRoot of candidateRoots) {
    const relativePath = convertToProjectRelativePath(candidateRoot, absolutePath.toString());
    if (relativePath !== undefined) {
      return candidateRoot;
    }
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
