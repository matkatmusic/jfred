// §a cross-source identity join: content-agreement gate and clone-on-write path remap.

import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { validateJoinContentAgreement, reportJoinedPathConflicts } from "./reconstruction_multi_source_gate.ts";
import { copyRecordReplacingPath } from "./reconstruction_multi_source_clone.ts";
import {
  collectPrimaryPaths,
  collectRelativePathMap,
  computeRootOrder,
  filterRecordsByRoot,
  findFirstEventForPath,
  isRecordInRoot,
} from "./reconstruction_multi_source_paths.ts";
import type { PrimaryPath } from "./reconstruction_multi_source_paths.ts";

// Clone-remap every record of the later root's sessions from one absolute path onto the primary.
function replaceLaterRootRecordPaths(
  records: TranscriptRecord[],
  sessionRoots: Map<string, Path>,
  laterRoot: string,
  fromPath: Path,
  toPath: Path,
): TranscriptRecord[] {
  const remapped: TranscriptRecord[] = [];
  for (const record of records) {
    const isLaterRootRecord = isRecordInRoot(record, sessionRoots, laterRoot);
    remapped.push(isLaterRootRecord ? copyRecordReplacingPath(record, fromPath, toPath) : record);
  }
  return remapped;
}

// Gate later root's evidence against primary, remap on agreement.
function joinRelativePath(
  workingRecords: TranscriptRecord[],
  sources: SourceEntry[],
  sessionRoots: Map<string, Path>,
  laterRoot: string,
  laterAbsolute: string,
  primary: PrimaryPath,
): TranscriptRecord[] {
  const laterRecords = filterRecordsByRoot(workingRecords, sessionRoots, laterRoot);
  const evidence = findFirstEventForPath(laterRecords, laterAbsolute);
  if (evidence === undefined) {
    return workingRecords;
  }
  const earlierRecords = filterRecordsByRoot(workingRecords, sessionRoots, primary.root);
  const isAgreeing = validateJoinContentAgreement(earlierRecords, new Path(primary.absolute), evidence, sources);
  if (!isAgreeing) {
    return workingRecords;
  }
  return replaceLaterRootRecordPaths(
    workingRecords, sessionRoots, laterRoot, new Path(laterAbsolute), new Path(primary.absolute));
}

// Join every rel-path the later root shares with an earlier root.
function joinPathsOfLaterRoot(
  workingRecords: TranscriptRecord[],
  sources: SourceEntry[],
  sessionRoots: Map<string, Path>,
  rootOrder: string[],
  laterIndex: number,
  joinedPrimaries: Set<string>,
): TranscriptRecord[] {
  const laterRoot = rootOrder[laterIndex]!;
  const laterPathMap = collectRelativePathMap(
    filterRecordsByRoot(workingRecords, sessionRoots, laterRoot), laterRoot);
  const primaryPaths = collectPrimaryPaths(workingRecords, sessionRoots, rootOrder, laterIndex);
  for (const [relative, laterAbsolute] of laterPathMap) {
    const primary = primaryPaths.get(relative);
    if (primary === undefined) {
      continue;
    }
    const isSamePath = primary.absolute === laterAbsolute;
    if (isSamePath) {
      continue;
    }
    const joinedRecords = joinRelativePath(
      workingRecords, sources, sessionRoots, laterRoot, laterAbsolute, primary);
    // remap always builds a new array, so a changed reference marks a completed join.
    if (joinedRecords !== workingRecords) {
      joinedPrimaries.add(primary.absolute);
    }
    workingRecords = joinedRecords;
  }
  return workingRecords;
}

// §a — join same-rel-path files across roots when content evidence agrees.
export function joinCrossSourceFileIdentities(
  records: TranscriptRecord[],
  sources: SourceEntry[],
  sessionRoots: Map<string, Path>,
): TranscriptRecord[] {
  const rootOrder = computeRootOrder(records, sessionRoots);
  if (rootOrder.length <= 1) {
    return records;
  }
  let workingRecords = records;
  const joinedPrimaries = new Set<string>();
  for (let laterIndex = 1; laterIndex < rootOrder.length; laterIndex++) {
    workingRecords = joinPathsOfLaterRoot(
      workingRecords, sources, sessionRoots, rootOrder, laterIndex, joinedPrimaries);
  }
  for (const primaryAbsolute of joinedPrimaries) {
    reportJoinedPathConflicts(workingRecords, new Path(primaryAbsolute), sources);
  }
  return workingRecords;
}
