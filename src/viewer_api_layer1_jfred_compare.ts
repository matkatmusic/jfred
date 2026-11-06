// Phase 3c of task 361: decide which engine files differ from the parent commit, writing nothing.

import { runJfredGit } from "./viewer_api_layer1_jfred_git.ts";
import { readCommittedFileBytes } from "./viewer_api_layer1_file.ts";
import { Path } from "./structures/domain.ts";

// "<path>" to mode for every file of the parent commit, one ls-tree call.
export function readParentModes(repoDir: Path, parentHash: string): Map<string, string> {
  const output = runJfredGit(repoDir, ["ls-tree", "-r", "-z", parentHash]);
  const modes = new Map<string, string>();
  for (const entry of output.split("\0")) {
    if (entry === "")
      continue;
    const [modeAndHash, entryPath] = entry.split("\t");
    const mode = modeAndHash!.split(" ")[0]!;
    modes.set(entryPath!, mode);
  }
  return modes;
}

function buildFinalBytes(text: string, hasFinalNewline: boolean): Buffer {
  const finalText = hasFinalNewline ? text + "\n" : text;
  return Buffer.from(finalText, "utf8");
}

function isFileChanged(repoDir: Path, parentHash: string, parentModes: Map<string, string>, relativePath: string, finalBytes: Buffer): boolean {
  const isNewFile = !parentModes.has(relativePath);
  if (isNewFile)
    return true;
  const parentBytes = readCommittedFileBytes(repoDir, new Path(relativePath), parentHash);
  return !parentBytes.equals(finalBytes);
}

// Read-only: returns the engine files whose final bytes differ from the parent's blob.
// ponytail: one process spawn per file; batch with git cat-file --batch when a project has thousands of files.
export function listChangedFiles(repoDir: Path, parentHash: string, engineTexts: ReadonlyMap<string, string>, findNewlinePaths: (relativePaths: string[]) => Set<string>): Map<string, Buffer> {
  const parentModes = readParentModes(repoDir, parentHash);
  const newlinePaths = findNewlinePaths([...engineTexts.keys()]);
  const changedFiles = new Map<string, Buffer>();
  for (const [relativePath, text] of engineTexts) {
    const finalBytes = buildFinalBytes(text, newlinePaths.has(relativePath));
    const isChanged = isFileChanged(repoDir, parentHash, parentModes, relativePath, finalBytes);
    if (isChanged)
      changedFiles.set(relativePath, finalBytes);
  }
  return changedFiles;
}
