// Task 357 step 4: rewound branches become lanes of file revisions, each with a rewind kind read from the engine's own pre-state check.

import { WireRewindKind, type WireBranchesViewOf } from "../webapp/layer1-wire-branches.ts";
import { loadSessionRewinds, groupSessionFiles, type SessionRewinds } from "./layer1_branch_sessions.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { EditEvent, FileEvent, FileHistory, FileRevision } from "./reconstruction_events.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { editEvidenceAgreesWithState } from "./reconstruction_multi_source_gate.ts";
import { linesTextOf } from "./reconstruction_revisions.ts";
import { createSidecarReader, findSessionId, resolveFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { reconstructStepTimeline } from "./reconstruction_steps.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getToolResultForUserRecord, indexToolUseNamesById } from "./structures/tool-results.ts";
import { BlockType, EventKind, ToolName } from "./structures/vocabulary.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_FINDING_BRANCHES = "finding branches";
export const LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES = "reconstructing branches";

export type Layer1WireBranchesView = WireBranchesViewOf<Date, Path, Uuid>;
type WireBranchRow = Layer1WireBranchesView["pairs"][number]["branches"][number];
type LaneKind = Pick<WireBranchRow, "rewindKind" | "rejoinAt" | "keptToEnd">;

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

// tool_use id to the Write result's originalFile; other tools carry no pre-state.
function indexWriteOriginalFiles(records: TranscriptRecord[]): Map<string, string | null> {
  const nameById = indexToolUseNamesById(records);
  const originalFileById = new Map<string, string | null>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_result || nameById.get(block.tool_use_id.toString()) !== ToolName.Write) {
        continue;
      }
      const resolved = getToolResultForUserRecord(record, nameById);
      if (resolved?.toolName === ToolName.Write) {
        originalFileById.set(block.tool_use_id.toString(), resolved.result.originalFile);
      }
    }
  }
  return originalFileById;
}

interface PreStateEvidence {
  eventById: Map<string, FileEvent>;
  writeOriginalFileById: Map<string, string | null>;
}

// Do the bytes the lane left on disk flow into `next`?
function doesNextRevisionKeepLaneBytes(next: FileRevision, laneLastLines: string[], evidence: PreStateEvidence): boolean {
  const event = evidence.eventById.get(next.changeId.toString());
  const laneLastText = laneLastLines.join("\n");
  if (event?.kind === EventKind.edit) {
    return editEvidenceAgreesWithState(event, laneLastText);
  }
  if (event?.kind === EventKind.write) {
    const originalFile = evidence.writeOriginalFileById.get(next.changeId.toString());
    const asEdit: EditEvent = { kind: EventKind.edit, changeId: event.changeId, target: event.target, hunks: [], originalFile, timestamp: event.timestamp };
    return typeof originalFile === "string" && originalFile !== "" && editEvidenceAgreesWithState(asEdit, laneLastText);
  }
  if (event?.kind === EventKind.overwrite) {
    return false;
  }
  const nextLines = new Set(linesTextOf(next));
  return laneLastLines.filter((line) => line.trim() !== "").every((line) => nextLines.has(line));
}

function classifyLane(revisions: FileRevision[], laneLastIndex: number, allLaneIds: Set<string>, evidence: PreStateEvidence): LaneKind {
  const laneLastLines = linesTextOf(revisions[laneLastIndex]!);
  const next = revisions.slice(laneLastIndex + 1).find((revision) => !allLaneIds.has(revision.changeId.toString()));
  if (next === undefined) {
    const isDiskFinalText = linesTextOf(revisions.at(-1)!).join("\n") === laneLastLines.join("\n");
    return isDiskFinalText ? { rewindKind: WireRewindKind.conversation, keptToEnd: true } : { rewindKind: WireRewindKind.code };
  }
  return doesNextRevisionKeepLaneBytes(next, laneLastLines, evidence)
    ? { rewindKind: WireRewindKind.conversation, rejoinAt: next.timestamp }
    : { rewindKind: WireRewindKind.code };
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

// Groups run in lexical order and the first lane per tool_use id stands: a resumed session repeats its parent's lanes.
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
