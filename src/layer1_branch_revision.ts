// A lane node's drawer text: after = that disk-timeline revision, before = the previous revision of the same path.

import { WireEditSide } from "../webapp/layer1-wire-edits.ts";
import { collectSessionFileGroups, loadSessionRewinds, type SessionRewinds } from "./layer1_branch_sessions.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import { buildGroupHistories, listLanes } from "./layer1_branches_lanes.ts";
import { convertToProjectRelativePath } from "./layer1_snapshot_wire.ts";
import { getLinesText } from "./reconstruction_revisions.ts";
import type { Path } from "./structures/domain.ts";

function containsChangeId(rewinds: SessionRewinds, changeId: string): boolean {
  for (const lane of listLanes(rewinds)) {
    const hasChange = lane.changeIds.has(changeId);
    if (hasChange) {
      return true;
    }
  }
  return false;
}

function findHistoryForPath(histories: FileHistory[], projectFolder: Path, relativePath: string): FileHistory | undefined {
  for (const candidate of histories) {
    const candidatePath = convertToProjectRelativePath(projectFolder, candidate.target.toString());
    const isMatch = candidatePath === relativePath;
    if (isMatch) {
      return candidate;
    }
  }
  return undefined;
}

function findRevisionIndex(history: FileHistory, changeId: string): number {
  for (const [index, revision] of history.revisions.entries()) {
    const isChange = revision.changeId.toString() === changeId;
    if (isChange) {
      return index;
    }
  }
  return -1;
}

// The first group (lexical, as the lanes dedupe) whose lane holds the change id stands.
export function readBranchRevisionSide(projectFolder: Path, sessionFiles: readonly Path[], relativePath: string, changeId: string, side: string): string {
  for (const group of collectSessionFileGroups(sessionFiles)) {
    const rewinds = loadSessionRewinds(group);
    const isLaneHolder = containsChangeId(rewinds, changeId);
    if (!isLaneHolder) {
      continue;
    }
    const history = findHistoryForPath(buildGroupHistories(rewinds), projectFolder, relativePath);
    if (history === undefined) {
      throw new Error(`no disk revision ${changeId} for ${relativePath}`);
    }
    const index = findRevisionIndex(history, changeId);
    if (index < 0) {
      throw new Error(`no disk revision ${changeId} for ${relativePath}`);
    }
    const revision = side === WireEditSide.base ? history.revisions[index - 1] : history.revisions[index];
    return revision === undefined ? "" : getLinesText(revision).join("\n");
  }
  throw new Error(`no branch lane holds ${changeId}`);
}
