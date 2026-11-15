// Task 361 phase 3c: build a git tree from the parent tree plus exact bytes.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJfredGit } from "./viewer_api_layer1_jfred_git.ts";
import { readParentModes } from "./viewer_api_layer1_jfred_compare.ts";
import { Path } from "./structures/domain.ts";

const NEW_FILE_MODE = "100644";

function writeBlobFiles(scratchFolder: string, files: Map<string, Buffer>): string[] {
  const blobFilePaths: string[] = [];
  for (const bytes of files.values()) {
    const blobFilePath = join(scratchFolder, `blob-${blobFilePaths.length}`);
    writeFileSync(blobFilePath, bytes);
    blobFilePaths.push(blobFilePath);
  }
  return blobFilePaths;
}

function computeBlobHashes(repoDir: Path, blobFilePaths: string[]): string[] {
  const output = runJfredGit(repoDir, ["hash-object", "-w", "--stdin-paths"], { input: blobFilePaths.join("\n") + "\n" });
  return output.split("\n");
}

function formatIndexInfo(files: Map<string, Buffer>, blobHashes: string[], parentModes: Map<string, string>): string {
  let indexInfo = "";
  let fileNumber = 0;
  for (const relativePath of files.keys()) {
    const mode = parentModes.get(relativePath) ?? NEW_FILE_MODE;
    indexInfo += `${mode} ${blobHashes[fileNumber]}\t${relativePath}\0`;
    fileNumber += 1;
  }
  return indexInfo;
}

// An all-zero hash with mode 0 removes the path from the index.
function formatDeleteIndexInfo(deletedPaths: string[]): string {
  let indexInfo = "";
  for (const relativePath of deletedPaths)
    indexInfo += `0 ${"0".repeat(40)}\t${relativePath}\0`;
  return indexInfo;
}

// ponytail: modes of new files are 100644 and symlinks are not special-cased; add when a real repo needs it.
export function buildTreeWithFiles(repoDir: Path, parentHash: string, files: Map<string, Buffer>, deletedPaths: string[]): string {
  const scratchFolder = mkdtempSync(join(tmpdir(), "jfred-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratchFolder, "index") };
    runJfredGit(repoDir, ["read-tree", parentHash], { env });
    let indexInfo = "";
    // hash-object exits 128 when given zero files.
    if (files.size > 0) {
      const blobFilePaths = writeBlobFiles(scratchFolder, files);
      const blobHashes = computeBlobHashes(repoDir, blobFilePaths);
      indexInfo = formatIndexInfo(files, blobHashes, readParentModes(repoDir, parentHash));
    }
    runJfredGit(repoDir, ["update-index", "-z", "--index-info"], { env, input: indexInfo + formatDeleteIndexInfo(deletedPaths) });
    return runJfredGit(repoDir, ["write-tree"], { env });
  }
  finally {
    rmSync(scratchFolder, { recursive: true, force: true });
  }
}
