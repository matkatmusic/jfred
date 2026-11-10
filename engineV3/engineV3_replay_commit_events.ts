// Makes the timeline's commit events, including commits that only the HEAD log still names.

import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { readCommitTimestamp } from "../src/reconstruction_base_commit_evidence.ts";
import { TimelineEventKind, type CommitHash, type TimelineEvent } from "./engineV3.ts";
import { parseLogFile } from "./engineV3_replay_git.ts";

const ZERO_HASH = "0".repeat(40);

function readCommitTimeMs(repoPath: Path, commit: CommitHash): number {
  const commitTime = readCommitTimestamp(repoPath, commit);
  if (commitTime === undefined) {
    throw new Error(`cannot read the commit time of ${commit.toString()}`);
  }
  return commitTime.getTime();
}

function collectCommitTexts(commits: CommitHash[]): Set<string> {
  const commitTexts = new Set<string>();
  for (const commit of commits) {
    commitTexts.add(commit.toString());
  }
  return commitTexts;
}

// Each commit that logs/HEAD moves HEAD to, and that is not in knownCommits, once.
export function listReflogOnlyCommits(repoPath: Path, knownCommits: CommitHash[]): CommitHash[] {
  const seenTexts = collectCommitTexts(knownCommits);
  const reflogOnlyCommits: CommitHash[] = [];
  for (const logLine of parseLogFile(join(repoPath.toString(), "logs", "HEAD"))) {
    if (logLine.newCommit !== ZERO_HASH) {
      const isSeen = seenTexts.has(logLine.newCommit);
      if (!isSeen) {
        seenTexts.add(logLine.newCommit);
        reflogOnlyCommits.push(new Uuid(logLine.newCommit));
      }
    }
  }
  return reflogOnlyCommits;
}

function compareEventTimes(first: TimelineEvent, second: TimelineEvent): number {
  return first.timestamp - second.timestamp;
}

// Oldest first; the merge with the JSONL lines needs commit events in time order.
export function createCommitEventsInTimeOrder(repoPath: Path, commits: CommitHash[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const commit of commits) {
    const timestamp = readCommitTimeMs(repoPath, commit);
    events.push({ type: TimelineEventKind.GitCommit, commit, timestamp });
  }
  events.sort(compareEventTimes);
  return events;
}
