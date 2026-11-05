// Task 358 part T: the working tree may only promote a beaconless file to verified, never mark a mismatch.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Path } from "./structures/domain.ts";

function isInsideFolder(folder: string, file: string): boolean {
  const fromFolder = relative(folder, file);
  return fromFolder !== "" && !fromFolder.startsWith("..") && !isAbsolute(fromFolder);
}

function isRegularFileInside(dir: Path, file: string): boolean {
  const isInside = isInsideFolder(dir.toString(), file);
  if (!isInside) {
    return false;
  }
  const stats = statSync(file, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile() && isInsideFolder(realpathSync(dir.toString()), realpathSync(file));
}

export function isMatchingWorkingTree(dir: Path, relativePath: Path, content: string): boolean {
  const file = resolve(dir.toString(), relativePath.toString());
  return isRegularFileInside(dir, file) && readFileSync(file, "utf8") === content;
}
