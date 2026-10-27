// A lane node's drawer text: after = that disk-timeline revision, before = the previous revision of the same path.

import { WireEditSide } from "../webapp/layer1-wire-edits.ts";
import { groupSessionFiles, loadSessionRewinds } from "./layer1_branch_sessions.ts";
import { buildGroupHistories, listLanes } from "./layer1_branches_lanes.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import { linesTextOf } from "./reconstruction_revisions.ts";
import type { Path } from "./structures/domain.ts";

// The first group (lexical, as the lanes dedupe) whose lane holds the change id stands.
export function readBranchRevisionSide(projectFolder: Path, sessionFiles: readonly Path[], relativePath: string, changeId: string, side: string): string {
  for (const group of groupSessionFiles(sessionFiles)) {
    const rewinds = loadSessionRewinds(group);
    if (!listLanes(rewinds).some((lane) => lane.changeIds.has(changeId))) {
      continue;
    }
    const history = buildGroupHistories(rewinds).find((candidate) => relativizeToProjectFolder(projectFolder, candidate.target.toString()) === relativePath);
    const index = history?.revisions.findIndex((revision) => revision.changeId.toString() === changeId) ?? -1;
    if (history === undefined || index < 0) {
      throw new Error(`no disk revision ${changeId} for ${relativePath}`);
    }
    const revision = side === WireEditSide.base ? history.revisions[index - 1] : history.revisions[index];
    return revision === undefined ? "" : linesTextOf(revision).join("\n");
  }
  throw new Error(`no branch lane holds ${changeId}`);
}
