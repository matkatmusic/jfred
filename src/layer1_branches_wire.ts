// Task 357 step 4: rewound branches become file-revision lanes, each with a rewind kind from the engine's pre-state check.

import type { WireBranchesViewOf } from "../webapp/layer1-wire-branches.ts";
import { loadSessionRewinds, groupSessionFiles, type SessionRewinds } from "./layer1_branch_sessions.ts";
import { buildGroupHistories, listLanes, type Lane } from "./layer1_branches_lanes.ts";
import { computeLaneKind, collectWriteOriginalFiles, type PreStateEvidence, type WireBranchRow } from "./layer1_branches_wire_classify.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_FINDING_BRANCHES = "finding branches";
export const LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES = "reconstructing branches";

export type Layer1WireBranchesView = WireBranchesViewOf<Date, Path, Uuid>;

function buildGroupBranches(projectFolder: Path, rewinds: SessionRewinds, lanes: Lane[]): { path: string; branch: WireBranchRow }[] {
  const { records } = rewinds;
  const histories = buildGroupHistories(rewinds);
  const allLaneIds = new Set<string>();
  for (const lane of lanes) {
    for (const changeId of lane.changeIds) {
      allLaneIds.add(changeId);
    }
  }
  const eventById = new Map<string, FileEvent>();
  for (const event of extractFileEvents(records)) {
    eventById.set(event.changeId.toString(), event);
  }
  const evidence: PreStateEvidence = { eventById, writeOriginalFileById: collectWriteOriginalFiles(records) };
  const built: { path: string; branch: WireBranchRow }[] = [];
  for (const lane of lanes) {
    for (const history of histories) {
      const path = relativizeToProjectFolder(projectFolder, history.target.toString());
      const laneIndexes: number[] = [];
      for (const [index, revision] of history.revisions.entries()) {
        const isLaneRevision = lane.changeIds.has(revision.changeId.toString());
        if (isLaneRevision) {
          laneIndexes.push(index);
        }
      }
      if (path === undefined) {
        continue;
      }
      if (laneIndexes.length === 0) {
        continue;
      }
      const kind = computeLaneKind(history.revisions, laneIndexes.at(-1)!, allLaneIds, evidence);
      const nodes: WireBranchRow["nodes"] = [];
      for (const index of laneIndexes) {
        const revision = history.revisions[index]!;
        nodes.push({ instant: revision.timestamp, changeId: revision.changeId, label: revision.kind });
      }
      built.push({ path, branch: { ...kind, forkAt: lane.forkAt, nodes } });
    }
  }
  return built;
}

function compareByForkAt(left: WireBranchRow, right: WireBranchRow): number {
  return left.forkAt.getTime() - right.forkAt.getTime();
}

// Groups run in lexical order; the first lane per tool_use id wins, since resumed sessions repeat parent lanes.
export function buildBranchesView(
  projectFolder: Path,
  sessionFiles: readonly Path[],
  reportProgress: ProgressSink = () => {},
): Layer1WireBranchesView {
  const groups = groupSessionFiles(sessionFiles);
  const groupsWithLanes: { rewinds: SessionRewinds; lanes: Lane[] }[] = [];
  for (const [index, group] of groups.entries()) {
    reportProgress({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, current: index + 1, total: groups.length });
    const rewinds = loadSessionRewinds(group);
    const lanes = listLanes(rewinds);
    if (lanes.length > 0) {
      groupsWithLanes.push({ rewinds, lanes });
    }
  }
  const branchesByPath = new Map<string, WireBranchRow[]>();
  const seenChangeIds = new Set<string>();
  for (const [index, { rewinds, lanes }] of groupsWithLanes.entries()) {
    reportProgress({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, current: index + 1, total: groupsWithLanes.length });
    const groupIds: string[] = [];
    for (const { path, branch } of buildGroupBranches(projectFolder, rewinds, lanes)) {
      const nodes: WireBranchRow["nodes"] = [];
      for (const node of branch.nodes) {
        const isUnseen = !seenChangeIds.has(node.changeId.toString());
        if (isUnseen) {
          nodes.push(node);
          groupIds.push(node.changeId.toString());
        }
      }
      if (nodes.length > 0) {
        branchesByPath.set(path, [...(branchesByPath.get(path) ?? []), { ...branch, nodes }]);
      }
    }
    for (const id of groupIds) {
      seenChangeIds.add(id);
    }
  }
  const pairs: Layer1WireBranchesView["pairs"] = [];
  for (const [path, branches] of branchesByPath) {
    pairs.push({ path: new Path(path), branches: branches.sort(compareByForkAt) });
  }
  return { pairs };
}
