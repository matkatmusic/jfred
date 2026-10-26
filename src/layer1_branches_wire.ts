// Task 357 step 4: rewound branches become file-revision lanes, each with a rewind kind from the engine's pre-state check.

import type { WireBranchesViewOf } from "../webapp/layer1-wire-branches.ts";
import { loadSessionRewinds, groupSessionFiles, type SessionRewinds } from "./layer1_branch_sessions.ts";
import { classifyLane, indexWriteOriginalFiles, type PreStateEvidence, type WireBranchRow } from "./layer1_branches_wire_classify.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { createSidecarReader, findSessionId, resolveFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { reconstructStepTimeline } from "./reconstruction_steps.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_FINDING_BRANCHES = "finding branches";
export const LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES = "reconstructing branches";

export type Layer1WireBranchesView = WireBranchesViewOf<Date, Path, Uuid>;

export interface Lane {
  forkAt: Date;
  changeIds: Set<string>;
}

// A stampless record takes the previous stamped record's time (plans/340-recon/DECISIONS.md).
function findInstantOfRecord(records: TranscriptRecord[], uuid: Uuid): Date {
  let lastStamp: Date | undefined;
  for (const record of records) {
    lastStamp = record.timestamp ?? lastStamp;
    if (record.uuid?.toString() === uuid.toString()) {
      if (lastStamp === undefined) {
        throw new Error(`no time derivable for rewind point ${uuid.toString()}`);
      }
      return lastStamp;
    }
  }
  throw new Error(`rewind point ${uuid.toString()} is not in the loaded records`);
}

// Lane records: the tip's chain minus the rewind point's chain; the rewind point itself belongs to the trunk.
export function listLanes({ records, branches }: SessionRewinds): Lane[] {
  const lanes: Lane[] = [];
  for (const branch of branches) {
    const memberUuids = collectAncestorUuids(records, branch.tip);
    for (const uuid of collectAncestorUuids(records, branch.rewindPoint)) {
      memberUuids.delete(uuid);
    }
    const laneRecords = records.filter((record) => record.uuid !== undefined && memberUuids.has(record.uuid.toString()));
    const changeIds = new Set(extractFileEvents(laneRecords).map((event) => event.changeId.toString()));
    if (changeIds.size > 0) {
      lanes.push({ forkAt: findInstantOfRecord(records, branch.rewindPoint), changeIds });
    }
  }
  return lanes;
}

// ponytail: keyed by the cached SessionRewinds, so it lives and dies with that cache entry
const historiesByRewinds = new WeakMap<SessionRewinds, FileHistory[]>();

// One disk timeline per loaded group: the lanes and a lane node's drawer read the same revisions.
export function reconstructGroupHistories(rewinds: SessionRewinds): FileHistory[] {
  const known = historiesByRewinds.get(rewinds);
  if (known !== undefined) {
    return known;
  }
  const sessionId = findSessionId(rewinds.records);
  if (sessionId === undefined) {
    throw new Error(`no session id in ${rewinds.parentFile.toString()}`);
  }
  const { histories } = reconstructStepTimeline(rewinds.records, createSidecarReader(sessionId, resolveFileHistoryRoot(rewinds.records)));
  historiesByRewinds.set(rewinds, histories);
  return histories;
}

function buildGroupBranches(projectFolder: Path, rewinds: SessionRewinds, lanes: Lane[]): { path: string; branch: WireBranchRow }[] {
  const { records } = rewinds;
  const histories = reconstructGroupHistories(rewinds);
  const allLaneIds = new Set(lanes.flatMap((lane) => [...lane.changeIds]));
  const evidence: PreStateEvidence = {
    eventById: new Map(extractFileEvents(records).map((event) => [event.changeId.toString(), event])),
    writeOriginalFileById: indexWriteOriginalFiles(records),
  };
  const built: { path: string; branch: WireBranchRow }[] = [];
  for (const lane of lanes) {
    for (const history of histories) {
      const path = relativizeToProjectFolder(projectFolder, history.target.toString());
      const laneIndexes = history.revisions.flatMap((revision, index) => (lane.changeIds.has(revision.changeId.toString()) ? [index] : []));
      if (path === undefined || laneIndexes.length === 0) {
        continue;
      }
      const kind = classifyLane(history.revisions, laneIndexes.at(-1)!, allLaneIds, evidence);
      const nodes = laneIndexes.map((index) => {
        const revision = history.revisions[index]!;
        return { instant: revision.timestamp, changeId: revision.changeId, label: revision.kind };
      });
      built.push({ path, branch: { ...kind, forkAt: lane.forkAt, nodes } });
    }
  }
  return built;
}

// Groups run in lexical order; the first lane per tool_use id wins, since resumed sessions repeat parent lanes.
export function buildBranchesView(
  projectFolder: Path,
  sessionFiles: readonly Path[],
  reportProgress: ProgressSink = () => {},
): Layer1WireBranchesView {
  const groups = groupSessionFiles(sessionFiles);
  const groupsWithLanes: { rewinds: SessionRewinds; lanes: Lane[] }[] = [];
  groups.forEach((group, index) => {
    reportProgress({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, current: index + 1, total: groups.length });
    const rewinds = loadSessionRewinds(group);
    const lanes = listLanes(rewinds);
    if (lanes.length > 0) {
      groupsWithLanes.push({ rewinds, lanes });
    }
  });
  const branchesByPath = new Map<string, WireBranchRow[]>();
  const seenChangeIds = new Set<string>();
  groupsWithLanes.forEach(({ rewinds, lanes }, index) => {
    reportProgress({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, current: index + 1, total: groupsWithLanes.length });
    const groupIds: string[] = [];
    for (const { path, branch } of buildGroupBranches(projectFolder, rewinds, lanes)) {
      const nodes = branch.nodes.filter((node) => !seenChangeIds.has(node.changeId.toString()));
      if (nodes.length > 0) {
        branchesByPath.set(path, [...(branchesByPath.get(path) ?? []), { ...branch, nodes }]);
        groupIds.push(...nodes.map((node) => node.changeId.toString()));
      }
    }
    groupIds.forEach((id) => seenChangeIds.add(id));
  });
  return {
    pairs: [...branchesByPath].map(([path, branches]) => ({
      path: new Path(path),
      branches: branches.sort((left, right) => left.forkAt.getTime() - right.forkAt.getTime()),
    })),
  };
}
