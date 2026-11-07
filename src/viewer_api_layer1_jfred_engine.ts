// Engine files at the mark instant for the Layer 1 jfred commit route (task 361, phase 3a).

import { buildReconstructionWithConsent } from "./viewer_api.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { BeaconCandidate } from "./layer1_beacon_candidates.ts";
import type { FileHistory, FileRevision } from "./reconstruction_events.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { BuiltReconstruction } from "./reconstruction_json.ts";
import { computeRepoStateAtTime } from "./reconstruction_steps.ts";
import { convertToProjectRelativePath } from "./layer1_snapshot_wire.ts";
// import { dirname } from "node:path";
import { Path } from "./structures/domain.ts";
import { getProjectsDirOfLog } from "./reconstruction_sidecar_reader.ts";
import type { PathOverrides, SourceEntry } from "./reconstruction_overrides.ts";
// import { getEffectiveFileHistoryDir } from "./viewer_api_projects.ts";

// The page's own folders; each chat's backups come from the file-history next to its projects folder.
export function buildCommitPathOverrides(dir: Path, repoDir: Path, sessionFiles: Path[]): PathOverrides {
  const projectsDirs = new Set<string>();
  for (const sessionFile of sessionFiles) {
    // // ponytail: subagent transcripts nested deeper get the wrong projects folder.
    projectsDirs.add(getProjectsDirOfLog(sessionFile).toString());
  }
  const sources: SourceEntry[] = [];
  for (const projectsDir of projectsDirs) {
    sources.push({ projectsDir: new Path(projectsDir) });
  }
  return { projectCwd: dir, repoDir, sources };
}

// onProgress is the route's writeNdjsonLine: the engine's stage events reach the page's loading bar.
export function buildJfredReconstruction(jsonlPaths: Path[], overrides: PathOverrides, allowScripts: boolean, onProgress: ProgressSink): BuiltReconstruction {
  return buildReconstructionWithConsent(jsonlPaths, undefined, allowScripts, onProgress, true, undefined, overrides);
}

// Engine text per project-relative path at `when`; a file outside the project folder is not part of the repo.
export function listEngineFilesAt(dir: Path, histories: FileHistory[], when: Date): Map<string, string> {
  const files = new Map<string, string>();
  for (const [absolutePath, text] of computeRepoStateAtTime(histories, when)) {
    const relativePath = convertToProjectRelativePath(dir, absolutePath.toString());
    if (relativePath !== undefined) {
      files.set(relativePath, text);
    }
  }
  return files;
}

export type UnrebuiltFile = { relativePath: string; reason: string; nextInstant: Date | undefined };

// edit, rename and delete never give the whole text back.
const WHOLE_FILE_KINDS = [EventKind.write, EventKind.overwrite, EventKind.append, EventKind.scriptExecution, EventKind.copy, EventKind.userEdit];

function findLastFailedRevisionIndexAtOrBefore(revisions: FileRevision[], when: Date): number {
  let failedIndex = -1;
  for (const [index, revision] of revisions.entries()) {
    const isAtOrBefore = revision.timestamp.getTime() <= when.getTime();
    if (isAtOrBefore) {
      if (revision.unrecoverable !== undefined) {
        failedIndex = index;
      }
    }
  }
  return failedIndex;
}

function listWholeFileInstantsAfterIndex(revisions: FileRevision[], failedIndex: number): Date[] {
  const instants: Date[] = [];
  for (const revision of revisions.slice(failedIndex + 1)) {
    const isWholeFileKind = WHOLE_FILE_KINDS.includes(revision.kind);
    if (isWholeFileKind) {
      if (revision.unrecoverable === undefined) {
        instants.push(revision.timestamp);
      }
    }
  }
  return instants;
}

function listBeaconInstantsAfter(candidates: BeaconCandidate[], failedInstant: Date): Date[] {
  const instants: Date[] = [];
  for (const candidate of candidates) {
    const isAfterFailure = candidate.instant.getTime() > failedInstant.getTime();
    if (isAfterFailure) {
      instants.push(candidate.instant);
    }
  }
  return instants;
}

function isAnyInstantAtOrBefore(instants: Date[], when: Date): boolean {
  for (const instant of instants) {
    const isAtOrBefore = instant.getTime() <= when.getTime();
    if (isAtOrBefore) {
      return true;
    }
  }
  return false;
}

function selectEarlierInstant(current: Date | undefined, candidate: Date): Date {
  if (current === undefined) {
    return candidate;
  }
  const isEarlier = candidate.getTime() < current.getTime();
  if (isEarlier) {
    return candidate;
  }
  return current;
}

function findEarliestInstantAfter(instants: Date[], when: Date): Date | undefined {
  let earliest: Date | undefined;
  for (const instant of instants) {
    const isAfter = instant.getTime() > when.getTime();
    if (isAfter) {
      earliest = selectEarlierInstant(earliest, instant);
    }
  }
  return earliest;
}

// The name the file held at `when`: the one key of its own one-file state.
function findPathAtMark(history: FileHistory, when: Date): Path {
  const [pathAtMark] = computeRepoStateAtTime([history], when).keys();
  return pathAtMark!;
}

function findUnrebuiltFileFromFailure(relativePath: string, target: Path, history: FileHistory, failedIndex: number, markInstant: Date, listBeacons: (target: Path) => BeaconCandidate[]): UnrebuiltFile | undefined {
  const failedRevision = history.revisions[failedIndex]!;
  const evidenceInstants = [...listWholeFileInstantsAfterIndex(history.revisions, failedIndex), ...listBeaconInstantsAfter(listBeacons(target), failedRevision.timestamp)];
  const isKnownAgain = isAnyInstantAtOrBefore(evidenceInstants, markInstant);
  if (isKnownAgain) {
    return undefined;
  }
  return { relativePath, reason: failedRevision.unrecoverable!.reason, nextInstant: findEarliestInstantAfter(evidenceInstants, markInstant) };
}

function findUnrebuiltFile(dir: Path, history: FileHistory, markInstant: Date, listBeacons: (target: Path) => BeaconCandidate[]): UnrebuiltFile | undefined {
  const failedIndex = findLastFailedRevisionIndexAtOrBefore(history.revisions, markInstant);
  const hasFailure = failedIndex !== -1;
  if (!hasFailure) {
    return undefined;
  }
  const target = findPathAtMark(history, markInstant);
  const relativePath = convertToProjectRelativePath(dir, target.toString());
  if (relativePath === undefined) {
    return undefined;
  }
  return findUnrebuiltFileFromFailure(relativePath, target, history, failedIndex, markInstant, listBeacons);
}

// Files in the folder whose failed revision has no whole-file evidence before the mark.
export function listUnrebuiltFilesAt(dir: Path, histories: FileHistory[], markInstant: Date, listBeacons: (target: Path) => BeaconCandidate[]): UnrebuiltFile[] {
  const files: UnrebuiltFile[] = [];
  for (const history of histories) {
    const file = findUnrebuiltFile(dir, history, markInstant, listBeacons);
    if (file !== undefined) {
      files.push(file);
    }
  }
  return files;
}

// A path only in `before` (a deletion) is not a change: jfred trees keep repo-only files.
function isAnyFileTextChanged(before: Map<string, string>, after: Map<string, string>): boolean {
  for (const [relativePath, afterText] of after) {
    const beforeText = before.get(relativePath);
    const isChanged = beforeText !== afterText;
    if (isChanged) {
      return true;
    }
  }
  return false;
}

// The first step after the mark where some file text differs from the mark; undefined when none.
// ponytail: recomputes the whole state per later step; stop early by changedPaths when a project has thousands of steps.
export function findNextChangingInstant(dir: Path, built: BuiltReconstruction, markInstant: Date, markFiles: Map<string, string>): Date | undefined {
  for (const step of built.document.steps) {
    const isAfterMark = step.when.getTime() > markInstant.getTime();
    if (isAfterMark) {
      const stepFiles = listEngineFilesAt(dir, built.stepFileHistories, step.when);
      const isStepChanged = isAnyFileTextChanged(markFiles, stepFiles);
      if (isStepChanged) {
        return step.when;
      }
    }
  }
  return undefined;
}
