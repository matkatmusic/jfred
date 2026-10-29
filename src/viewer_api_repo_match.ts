// Counts how many recorded file paths resolve inside a candidate commit's tree.

import { execSync } from "node:child_process";
import { relative } from "node:path";
import { findFirstRecordCwd } from "./reconstruction_base_commit_evidence.ts";
import { listEventPaths } from "./reconstruction_bound.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { type TranscriptRecord } from "./structures/envelope.ts";
import { countPathsInTree } from "./viewer_api_repo_commits.ts";

// Recorded targets under the recorded project root, as repo-relative paths.
function computeRecordedRelativePaths(records: TranscriptRecord[]): string[] {
  const recordedRoot = findFirstRecordCwd(records);
  if (recordedRoot === undefined) {
    return [];
  }
  const uniqueTargets = new Set<string>();
  for (const event of extractFileEvents(records)) {
    for (const eventPath of listEventPaths(event)) {
      uniqueTargets.add(eventPath.toString());
    }
  }
  const relativePaths: string[] = [];
  for (const target of uniqueTargets) {
    const relativePath = relative(recordedRoot.toString(), target);
    const isRoot = relativePath === "";
    const isOutsideRoot = relativePath.startsWith("..");
    const isSkipped = isRoot || isOutsideRoot;
    if (isSkipped) {
      continue;
    }
    relativePaths.push(relativePath);
  }
  return relativePaths;
}

// The match counts for one candidate commit: recorded relative paths vs the commit's tree.
export function computeCommitPathMatch(records: TranscriptRecord[], repoDir: Path, commit: Uuid): { matchedCount: number; totalCount: number } {
  const treeOutput = execSync(`git ls-tree -r --name-only ${commit.toString()}`, {
    cwd: repoDir.toString(),
    stdio: "pipe",
  }).toString();
  const treePaths = new Set<string>();
  for (const line of treeOutput.split("\n")) {
    if (line !== "") {
      treePaths.add(line);
    }
  }
  return countPathsInTree(computeRecordedRelativePaths(records), treePaths);
}
