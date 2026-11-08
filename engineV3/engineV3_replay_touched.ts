// Every file path the replay writes or removes, kept so the run can be checked against the disk.

import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Path } from "../src/structures/domain.ts";

const touchedAbsolutePaths = new Set<string>();

export function recordTouchedPath(absolutePath: string): void {
  touchedAbsolutePaths.add(absolutePath);
}

// A removed folder touches every file under it.
export function recordTouchedFilesUnder(folder: string): void {
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      recordTouchedPath(join(entry.parentPath, entry.name));
    }
  }
}

export function clearTouchedPaths(): void {
  touchedAbsolutePaths.clear();
}

export function listTouchedPaths(state: Path): string[] {
  const relativePaths: string[] = [];
  for (const absolutePath of touchedAbsolutePaths) {
    relativePaths.push(relative(state.toString(), absolutePath));
  }
  return relativePaths.sort();
}

export function writeTouchedPathsFile(state: Path, outputFile: Path): void {
  const lines = listTouchedPaths(state);
  writeFileSync(outputFile.toString(), lines.join("\n") + "\n");
}
