// Task 357 step 4: lanes of rewound branches and the one disk timeline per loaded session group.

import type { SessionRewinds } from "./layer1_branch_sessions.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { createSidecarReader } from "./reconstruction_sidecar_backup_path.ts";
import { findSessionId, getFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { buildStepTimeline } from "./reconstruction_steps.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";
import type { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

export interface Lane {
  forkAt: Date;
  changeIds: Set<string>;
}

// A stampless record takes the previous stamped record's time (plans/340-recon/DECISIONS.md).
function findInstantOfRecord(records: TranscriptRecord[], uuid: Uuid): Date {
  let lastStamp: Date | undefined;
  for (const record of records) {
    lastStamp = record.timestamp ?? lastStamp;
    const isRewindPoint = record.uuid?.toString() === uuid.toString();
    if (isRewindPoint) {
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
    const laneRecords: TranscriptRecord[] = [];
    for (const record of records) {
      const isLaneRecord = record.uuid !== undefined && memberUuids.has(record.uuid.toString());
      if (isLaneRecord) {
        laneRecords.push(record);
      }
    }
    const changeIds = new Set<string>();
    for (const event of extractFileEvents(laneRecords)) {
      changeIds.add(event.changeId.toString());
    }
    if (changeIds.size > 0) {
      lanes.push({ forkAt: findInstantOfRecord(records, branch.rewindPoint), changeIds });
    }
  }
  return lanes;
}

// ponytail: keyed by the cached SessionRewinds, so it lives and dies with that cache entry
const historiesByRewinds = new WeakMap<SessionRewinds, FileHistory[]>();

// One disk timeline per loaded group: the lanes and a lane node's drawer read the same revisions.
export function buildGroupHistories(rewinds: SessionRewinds): FileHistory[] {
  const known = historiesByRewinds.get(rewinds);
  if (known !== undefined) {
    return known;
  }
  const sessionId = findSessionId(rewinds.records);
  if (sessionId === undefined) {
    throw new Error(`no session id in ${rewinds.parentFile.toString()}`);
  }
  const { histories } = buildStepTimeline(rewinds.records, createSidecarReader(sessionId, getFileHistoryRoot(rewinds.records)));
  historiesByRewinds.set(rewinds, histories);
  return histories;
}
