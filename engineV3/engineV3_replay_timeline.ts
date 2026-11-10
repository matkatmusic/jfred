// The one merged timeline of git commits and JSONL lines, built once and memoized.

import { Path, Uuid } from "../src/structures/domain.ts";
import { TimelineEventKind, executeGit, type CommitHash, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
// import { listCommitsFromStartToEnd } from "./engineV3test.ts"; import { createCommitEventsInTimeOrder, listReflogOnlyCommits } from "./engineV3_replay_commit_events.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { listOutsideGitRows } from "./engineV3_replay_outside_git.ts";
import { mergePlateEventsIntoActions } from "./engineV3_replay_plate.ts";

export const TERMINAL_EVENT = Symbol("TERMINAL_EVENT");

// 2026-10-26T23:57:39Z, the first chat line: reflog rows at or before it are not replayed.
export const START_SECONDS = 1793059059;

type Timeline = { key: string; events: TimelineEvent[]; indexByEvent: Map<TimelineEvent, number> };

const SAME_SECOND_MS = 1000;
let timelineMemo: Timeline | undefined;

function convertToPathTexts(paths: Path[]): string[] {
  const texts: string[] = [];
  for (const path of paths) {
    texts.push(path.toString());
  }
  return texts;
}

function readGitText(repoPath: Path, args: string[]): string {
  const output = executeGit(repoPath, args);
  const text = output.toString("utf8");
  return text.trim();
}

// function readRootCommit(repoPath: Path): CommitHash {
//   const output = readGitText(repoPath, ["rev-list", "--max-parents=0", "HEAD"]);
//   const rootHashes = output.split("\n");
//   if (rootHashes.length !== 1) {
//     throw new Error(`readRootCommit: expected exactly one root commit in ${repoPath.toString()}, found ${rootHashes.length}`);
//   }
//   return new Uuid(rootHashes[0] as string);
// }

export function readHeadCommit(repoPath: Path): CommitHash {
  const hash = readGitText(repoPath, ["rev-parse", "HEAD"]);
  return new Uuid(hash);
}
// function createCommitEvents(repoPath: Path): TimelineEvent[] {
//   const rootCommit = readRootCommit(repoPath);
//   const headCommit = readHeadCommit(repoPath);
//   const commits = listCommitsFromStartToEnd(repoPath, rootCommit, headCommit);
//   const reflogOnlyCommits = listReflogOnlyCommits(repoPath, commits);
//   return createCommitEventsInTimeOrder(repoPath, [...commits, ...reflogOnlyCommits]);
// }

function createOutsideGitEvents(repoPath: Path | undefined, lines: JSONLLine[]): TimelineEvent[] {
  const rows = repoPath === undefined ? [] : listOutsideGitRows(repoPath, collectBashCallResults(lines), START_SECONDS);
  const events: TimelineEvent[] = [];
  for (const row of rows) {
    events.push({ type: TimelineEventKind.OutsideGitAction, row, timestamp: row.seconds * 1000 });
  }
  return events;
}

function createLineEvents(lines: JSONLLine[]): TimelineEvent[] {
  const events: TimelineEvent[] = new Array(lines.length);
  // A line with no time takes the time of the next timed line, or infinity after the last.
  let timeOfNextTimedLine = Number.POSITIVE_INFINITY;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index] as JSONLLine;
    const ownTime = line.timestamp?.getTime();
    if (ownTime !== undefined) {
      timeOfNextTimedLine = ownTime;
    }
    events[index] = { type: TimelineEventKind.JSONLLine, line, timestamp: timeOfNextTimedLine };
  }
  return events;
}

// A line in the same second as a commit goes before that commit (user ruling).
function mergeEventsByTime(commitEvents: TimelineEvent[], lineEvents: TimelineEvent[]): TimelineEvent[] {
  const merged: TimelineEvent[] = [];
  let commitIndex = 0;
  let lineIndex = 0;
  while (true) {
    const commitEvent = commitEvents[commitIndex];
    const lineEvent = lineEvents[lineIndex];
    if (commitEvent === undefined) {
      if (lineEvent === undefined) {
        return merged;
      }
      merged.push(lineEvent);
      lineIndex++;
      continue;
    }
    if (lineEvent === undefined) {
      merged.push(commitEvent);
      commitIndex++;
      continue;
    }
    if (lineEvent.timestamp < commitEvent.timestamp + SAME_SECOND_MS) {
      merged.push(lineEvent);
      lineIndex++;
      continue;
    }
    merged.push(commitEvent);
    commitIndex++;
  }
}

function createTimeline(key: string, repoPath: Path | undefined,jsonlsPaths: Path[], macPlatePath: Path | undefined): Timeline {
  const lines = loadMergedJSONLLines(convertToPathTexts(jsonlsPaths)).jsonlLines;
  // const commitEvents = createCommitEvents(repoPath);
  const actionEvents = mergePlateEventsIntoActions(createOutsideGitEvents(repoPath, lines), macPlatePath, jsonlsPaths);
  const lineEvents = createLineEvents(lines);
  const events = mergeEventsByTime(actionEvents, lineEvents);
  const indexByEvent = new Map<TimelineEvent, number>();
  for (const [index, event] of events.entries()) {
    indexByEvent.set(event, index);
  }
  return { key, events, indexByEvent };
}

function getTimeline(repoPath: Path | undefined, jsonlsPaths: Path[], macPlatePath: Path | undefined): Timeline {
  const key = JSON.stringify([repoPath?.toString(),convertToPathTexts(jsonlsPaths), macPlatePath?.toString()]);
  if (timelineMemo !== undefined) {
    if (timelineMemo.key === key) {
      return timelineMemo;
    }
  }
  timelineMemo = createTimeline(key, repoPath, jsonlsPaths, macPlatePath);
  return timelineMemo;
}

export function getNextEvent(repoPath: Path | undefined,jsonlsPaths: Path[], lastEvent: TimelineEvent | null, macPlatePath?: Path): TimelineEvent | typeof TERMINAL_EVENT {
  const timeline = getTimeline(repoPath, jsonlsPaths, macPlatePath);
  let nextIndex = 0;
  if (lastEvent !== null) {
    const lastIndex = timeline.indexByEvent.get(lastEvent);
    if (lastIndex === undefined) {
      throw new Error("getNextEvent: lastEvent is not in the timeline");
    }
    nextIndex = lastIndex + 1;
  }
  const nextEvent = timeline.events[nextIndex];
  if (nextEvent === undefined) {
    return TERMINAL_EVENT;
  }
  return nextEvent;
}
