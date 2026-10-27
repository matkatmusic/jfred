// The commit picker's git log reader and tree-membership counter.

import { execSync } from "node:child_process";
import { Path } from "./structures/domain.ts";
import type { RepoCommitRow } from "../webapp/layer1-wire.ts";

// git log lines are <hash>\t<date>\t<subject>; the subject may contain further tabs.
export function parseGitLogOutput(output: string): RepoCommitRow[] {
  const rows: RepoCommitRow[] = [];
  for (const line of output.split("\n")) {
    if (line === "") {
      continue;
    }
    const [hash, date, ...subjectParts] = line.split("\t");
    rows.push({ hash: hash!, date: date!, subject: subjectParts.join("\t") });
  }
  return rows;
}

// The repo's commits, newest first (git log order).
// ponytail: 500 newest commits; paginate if a picker ever needs more.
export function listRepoCommits(repoDir: Path): RepoCommitRow[] {
  const output = execSync("git log --format=%H%x09%ad%x09%s --date=short -n 500", {
    cwd: repoDir.toString(),
    stdio: "pipe",
  }).toString();
  return parseGitLogOutput(output);
}

// The soft-warning math: how many recorded relative paths exist in the commit's tree.
export function countPathsInTree(relativePaths: string[], treePaths: Set<string>): { matchedCount: number; totalCount: number } {
  let matchedCount = 0;
  for (const relativePath of relativePaths) {
    const isInTree = treePaths.has(relativePath);
    if (isInTree) {
      matchedCount++;
    }
  }
  return { matchedCount, totalCount: relativePaths.length };
}
