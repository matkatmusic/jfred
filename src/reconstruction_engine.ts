// Core reconstruction model: transcript records to per-file revision history.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { FileHistory, FileRevision } from "./reconstruction_events.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import {
  collectSurvivingUuids,
  findConversationBranches,
  selectLiveBranch,
  type ConversationBranch,
} from "./reconstruction_branch.ts";
import { selectBranchRecords } from "./reconstruction_branch_records.ts";
import { reconstructFileOver } from "./reconstruction_branches.ts";
import { reconstructFilesOver } from "./reconstruction_renderable.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// --- Reconstruction: the public API ------------------------------------------

// Pre-selects the surviving branch, then delegates to reconstructFileOver.
export function reconstructFile(
  records: TranscriptRecord[],
  target: Path,
  reader?: BackupReader,
): FileRevision[] {
  return reconstructFileOver(selectLiveBranch(records), target, new Set<string>(), reader);
}

// Pre-selects the surviving branch, then reconstructs all files.
export function reconstructAll(
  records: TranscriptRecord[],
  reader?: BackupReader,
): FileHistory[] {
  reportReconstructionProgress(`reconstructing surviving files across ${records.length} records`);
  return reconstructFilesOver(selectLiveBranch(records), reader);
}

// --- Branch-aware reconstruction: surviving + retrievable rewound branches -----

// Files changed after a rewind point on a single rewound branch.
export type RewoundBranchHistory = {
  rewindPoint: Uuid;
  tip: Uuid;
  histories: FileHistory[];
};

// Branch-aware result: surviving files plus rewound branches.
export type BranchedReconstruction = {
  survivingTip: Uuid | undefined;
  surviving: FileHistory[];
  rewound: RewoundBranchHistory[];
};

// Surviving files plus every unmerged rewound branch's file changes.
export function reconstructBranches(
  records: TranscriptRecord[],
  reader?: BackupReader,
): BranchedReconstruction {
  // task 191: emit progress here so --progress doesn't go silent between sidecar and tip-scan.
  reportReconstructionProgress(`finding conversation branches across ${records.length} records`);
  const branches = findConversationBranches(records);
  let survivingBranch: ConversationBranch | undefined;
  const rewoundBranches: ConversationBranch[] = [];
  for (const branch of branches) {
    const isFirstSurviving = branch.isSurviving && survivingBranch === undefined;
    if (isFirstSurviving) {
      survivingBranch = branch;
    }
    if (!branch.isSurviving) {
      rewoundBranches.push(branch);
    }
  }
  const surviving = reconstructAll(records, reader);
  const rewound: RewoundBranchHistory[] = [];
  for (const [branchIndex, branch] of rewoundBranches.entries()) {
    // task 163: report branch-level progress; prefix must be "reconstructing " for webapp phase 4.
    reportReconstructionProgress("reconstructing rewound branch", branchIndex + 1, rewoundBranches.length);
    const history = buildRewoundBranchHistory(records, branch, reader);
    if (history !== undefined) {
      rewound.push(history);
    }
  }
  return { survivingTip: survivingBranch?.tip, surviving, rewound };
}

// Returns undefined when the branch's diverging portion changed no files.
function buildRewoundBranchHistory(
  records: TranscriptRecord[],
  branch: ConversationBranch,
  reader?: BackupReader,
): RewoundBranchHistory | undefined {
  const branchRecords = selectBranchRecords(records, branch.tip);
  const survivingUuids = collectSurvivingUuids(records);
  const divergingRecords: TranscriptRecord[] = [];
  for (const record of branchRecords) {
    const recordUuid = record.uuid;
    const isDiverging = recordUuid !== undefined && !survivingUuids.has(recordUuid.toString());
    if (isDiverging) {
      divergingRecords.push(record);
    }
  }
  const divergingIds = new Set<string>();
  for (const event of extractFileEvents(divergingRecords)) {
    divergingIds.add(event.changeId.toString());
  }
  if (divergingIds.size === 0) {
    return undefined;
  }
  const histories: FileHistory[] = [];
  for (const history of reconstructFilesOver(branchRecords, reader)) {
    let touchesDiverging = false;
    for (const revision of history.revisions) {
      const isDivergingRevision = divergingIds.has(revision.changeId.toString());
      if (isDivergingRevision) {
        touchesDiverging = true;
      }
    }
    if (touchesDiverging) {
      histories.push(history);
    }
  }
  return { rewindPoint: branch.rewindPoint!, tip: branch.tip, histories };
}
