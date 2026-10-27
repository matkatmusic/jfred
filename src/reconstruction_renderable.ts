// All-files reconstruction and the accepted-user-edit filters that let views agree on real edits.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { FailureScope } from "./structures/vocabulary_views.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { findConversationBranches } from "./reconstruction_branch.ts";
import { selectBranchRecords } from "./reconstruction_branch_records.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { discoverScriptCreatedPaths } from "./reconstruction_script_runs.ts";
import { appendScriptMoveRenames } from "./reconstruction_script_move_events.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import {
  buildRenameChain,
  distinctFinalPaths,
  resolveFinalPath,
} from "./reconstruction_lineage.ts";
import { getFileRevisionsOver } from "./reconstruction_branches.ts";
import { getLineageContentBefore } from "./reconstruction_lineage_content.ts";
import type { FileEvent, FileHistory } from "./reconstruction_events.ts";

// Script-born files leave no Write/Edit event, so the runs that created them add their targets.
function addScriptCreatedTargets(
  targets: Path[],
  records: TranscriptRecord[],
  reader: BackupReader,
  renameChain: Map<string, Path>,
): void {
  const known = new Set<string>();
  for (const target of targets) {
    known.add(target.toString());
  }
  for (const path of discoverScriptCreatedPaths(records, reader, getLineageContentBefore(records, reader))) {
    const finalPath = resolveFinalPath(path, renameChain);
    const isKnown = known.has(finalPath.toString());
    if (isKnown)
      continue;
    known.add(finalPath.toString());
    targets.push(finalPath);
  }
}

// Per-file backstop: a failure degrades to an empty history for this file only (task 119).
function getFileHistoryOrEmpty(records: TranscriptRecord[], target: Path, reader?: BackupReader): FileHistory {
  try {
    const revisions = getFileRevisionsOver(records, target, new Set<string>(), reader);
    return { target, revisions };
  }
  catch (error) {
    noteReconstructionFailure({ scope: FailureScope.file, stage: "getFileHistoriesOver", target, reason: String(error) });
    return { target, revisions: [] };
  }
}

// Reconstruct every file touched by exactly these records, keyed by the path it ends life at.
export function getFileHistoriesOver(
  records: TranscriptRecord[],
  reader?: BackupReader,
): FileHistory[] {
  reportReconstructionProgress(`extracting file events from ${records.length} records`);
  const extracted = extractFileEvents(records);
  const events = appendScriptMoveRenames(extracted, records, reader, reader ? getLineageContentBefore(records, reader) : undefined);
  const renameChain = buildRenameChain(events);
  const targets = distinctFinalPaths(events, renameChain);
  if (reader) {
    addScriptCreatedTargets(targets, records, reader, renameChain);
  }
  const histories: FileHistory[] = [];
  for (const [index, target] of targets.entries()) {
    reportReconstructionProgress(`reconstructing ${target}`, index + 1, targets.length);
    histories.push(getFileHistoryOrEmpty(records, target, reader));
  }
  return histories;
}

// The changeIds of surviving user-edit revisions in one reconstructed file history.
function getUserEditIdsOf(history: FileHistory): string[] {
  const changeIds: string[] = [];
  for (const revision of history.revisions) {
    const isUserEdit = revision.kind === EventKind.userEdit;
    if (isUserEdit)
      changeIds.push(revision.changeId.toString());
  }
  return changeIds;
}

// Add every surviving user-edit changeId of one branch's histories into the accepted set.
function addBranchUserEditIds(histories: FileHistory[], accepted: Set<string>): void {
  for (const history of histories) {
    for (const id of getUserEditIdsOf(history)) {
      accepted.add(id);
    }
  }
}

// The changeIds of every user edit that actually changed a file, judged per conversation branch.
export function collectAcceptedUserEditIds(
  records: TranscriptRecord[],
  reader?: BackupReader,
): Set<string> {
  const accepted = new Set<string>();
  const branches = findConversationBranches(records);
  for (const [branchIndex, branch] of branches.entries()) {
    reportReconstructionProgress(`reconstructing accepted user edits — branch ${branchIndex + 1}/${branches.length}`);
    const branchRecords = selectBranchRecords(records, branch.tip);
    addBranchUserEditIds(getFileHistoriesOver(branchRecords, reader), accepted);
  }
  return accepted;
}

// Non-user-edit events always render; a user edit renders only when its changeId is accepted.
export function isRenderableEvent(event: FileEvent, accepted: Set<string>): boolean {
  if (event.kind !== EventKind.userEdit) {
    return true;
  }
  return accepted.has(event.changeId.toString());
}

// The transcript's file events minus redundant disk-echo user edits; undefined keeps every event.
export function extractRenderableEvents(
  records: TranscriptRecord[],
  accepted?: Set<string>,
): FileEvent[] {
  const events = extractFileEvents(records);
  if (accepted === undefined) {
    return events;
  }
  const renderable: FileEvent[] = [];
  for (const event of events) {
    const isRenderable = isRenderableEvent(event, accepted);
    if (isRenderable)
      renderable.push(event);
  }
  return renderable;
}
