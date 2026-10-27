// File-change derivation for the revision timeline: step changeIds resolved into displayable chips.

import { routeToFileHistory } from "../app-routes.ts";
import { isChangeIdBackupBlobName, findRevisionForChangeId } from "./file-history-model.ts";
import {
  EDIT_EVENT_KIND,
  type FileChange,
  type RevisionIndex,
  type WireFileHistory,
  type WireStepSnapshot,
  type WireTimelineDocument,
} from "./timeline-types.ts";

// Wire mirror of BASE_COMMIT_CHANGE_ID_PREFIX: marks a base-commit baseline beacon.
export const GIT_BASE_CHANGE_ID_PREFIX = "gitBase:";

// Wire mirror of SCRIPT_RUN_CHANGE_ID_PREFIX: marks a synthetic `scriptRun:<tool_use id>:<target>` revision.
export const SCRIPT_RUN_CHANGE_ID_PREFIX = "scriptRun:";

// True when every changeId on the step is a base-commit beacon.
export function isSnapshotGitBaseline(snapshot: WireStepSnapshot): boolean {
  if (snapshot.changeIds.length === 0) {
    return false;
  }
  for (const changeId of snapshot.changeIds) {
    const isGitBaseId = changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX);
    if (!isGitBaseId) {
      return false;
    }
  }
  return true;
}

// The hash in gitBase:<hash>:<target>; "" for a malformed id, never a throw.
export function extractGitBaseCommitHash(changeId: string): string {
  return changeId.split(":")[1] ?? "";
}

// The baseline node's message text, naming the base commit the beacon changeId carries.
export function computeGitBaselineText(snapshot: WireStepSnapshot): string {
  return `Files seeded from git base commit ${extractGitBaseCommitHash(snapshot.changeIds[0]!)}`;
}

// Entry-time path per revision: walk backward from the final target, stepping each rename's `from`.
function computeEntryTimePaths(history: WireFileHistory): string[] {
  const entryTimePaths = new Array<string>(history.revisions.length);
  let currentPath = history.target;
  for (let index = history.revisions.length - 1; index >= 0; index -= 1) {
    entryTimePaths[index] = currentPath;
    const rename = history.revisions[index]!.rename;
    if (rename !== undefined) {
      currentPath = rename.from;
    }
  }
  return entryTimePaths;
}

// Index one history's revisions by changeId; earlier-indexed (surviving) histories win duplicates.
function storeHistoryRevisions(index: RevisionIndex, history: WireFileHistory, isRewound: boolean): void {
  const entryTimePaths = computeEntryTimePaths(history);
  for (let position = 0; position < history.revisions.length; position++) {
    const revision = history.revisions[position]!;
    const isAlreadyIndexed = index.has(revision.changeId);
    if (isAlreadyIndexed) {
      continue;
    }
    index.set(revision.changeId, {
      path: revision.rename !== undefined ? revision.rename.to : history.target,
      displayPath: entryTimePaths[position]!,
      eventKind: revision.kind,
      renamedFrom: revision.rename !== undefined ? revision.rename.from : undefined,
      isFirstRevision: position === 0,
      isRewound,
    });
  }
}

export function buildRevisionIndex(document: WireTimelineDocument): RevisionIndex {
  const index: RevisionIndex = new Map();
  const addHistories = (histories: WireFileHistory[], isRewound: boolean): void => {
    for (const history of histories) {
      storeHistoryRevisions(index, history, isRewound);
    }
  };
  addHistories(document.filesTouched, false);
  addHistories(document.rewoundFilesTouched, true);
  return index;
}

// A step's file chips, deduped by path; unresolved changed paths become edit chips.
export function computeFileChanges(step: WireStepSnapshot, revisionIndex: RevisionIndex): FileChange[] {
  const changes: FileChange[] = [];
  const seenPaths = new Set();
  for (const changeId of step.changeIds) {
    const revision = revisionIndex.get(changeId);
    if (revision === undefined) {
      continue;
    }
    const isSeenPath = seenPaths.has(revision.path);
    if (isSeenPath) {
      continue;
    }
    seenPaths.add(revision.path);
    changes.push({
      path: revision.path,
      displayPath: revision.displayPath,
      eventKind: revision.eventKind,
      renamedFrom: revision.renamedFrom,
      isFirstRevision: revision.isFirstRevision,
      changeId,
      when: step.when,
    });
  }
  for (const path of step.changedPaths) {
    const isSeenPath = seenPaths.has(path);
    if (isSeenPath) {
      continue;
    }
    seenPaths.add(path);
    changes.push({ path, displayPath: path, eventKind: EDIT_EVENT_KIND, renamedFrom: undefined, isFirstRevision: false, changeId: undefined, when: step.when });
  }
  return changes;
}

// The file route a chip jumps to, or undefined when no snapshot-backed revision exists.
export function computeSnapshotJumpRoute(project: string, filesTouched: WireFileHistory[], change: { path: string; changeId?: string }): string | undefined {
  if (change.changeId === undefined) {
    return undefined;
  }
  const isBackupBlob = isChangeIdBackupBlobName(change.changeId);
  if (!isBackupBlob) {
    return undefined;
  }
  const revisionLink = findRevisionForChangeId(filesTouched, change.changeId, undefined);
  if (revisionLink === undefined) {
    return undefined;
  }
  if (revisionLink.revisionNumber === undefined) {
    return undefined;
  }
  return `${routeToFileHistory(project, revisionLink.target)}/rev/${revisionLink.revisionNumber}`;
}

// old (pre engine-stamped isOrphaned): checkStepIsOrphaned, retired to archive/timeline-changes-retired-orphan-proxies.ts.
