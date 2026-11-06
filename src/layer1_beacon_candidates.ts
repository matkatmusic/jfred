// Task 358 part B: every proof file content for one target, from the same collectors layer 3 uses.

import { WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { collectCommitBeaconNodes } from "./layered_git_beacons.ts";
import type { BeaconNode } from "./layered_types.ts";
import { collectTargetSnapshotBeaconNodes } from "./layered_snapshot_beacons.ts";
import { collectBashCatBeacons } from "./layer1_cat_beacons.ts";
import { readSessionEditEvents, type LayerEditEvent } from "./layer1_edit_events.ts";
import { loadTranscript } from "./parse/loadTranscript.ts";
import type { PathOverrides, SourceEntry } from "./reconstruction_overrides.ts";
import { buildBackupPathResolver, buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// The tie order lives in SOURCE_TIE_RANK in layer1_run_verdict.ts.
export const BeaconSource = {
  fileHistory: "fileHistory",
  readEcho: "readEcho",
  bashCat: "bashCat",
  commit: "commit",
} as const;
export type BeaconSource = (typeof BeaconSource)[keyof typeof BeaconSource];

export type BeaconCandidate = { source: BeaconSource; instant: Date; content: string };

function buildCandidatesFromBeacons(source: BeaconSource, beacons: BeaconNode[]): BeaconCandidate[] {
  const candidates: BeaconCandidate[] = [];
  for (const beacon of beacons) {
    candidates.push({ source, instant: beacon.instant, content: beacon.content });
  }
  return candidates;
}

function collectBashCatIds(records: TranscriptRecord[], sessionFile: Path): Set<string> {
  const ids = new Set<string>();
  for (const beacon of collectBashCatBeacons(records, sessionFile)) {
    ids.add(beacon.changeId.toString());
  }
  return ids;
}

function compareCandidateInstants(left: BeaconCandidate, right: BeaconCandidate): number {
  return left.instant.getTime() - right.instant.getTime();
}

// readSessionEditEvents holds complete Read echoes only: a partial window becomes a stub, never an event.
function buildReadCandidate(event: LayerEditEvent, target: Path, bashCatIds: Set<string>): BeaconCandidate | undefined {
  const isReadOfTarget = event.kind === WireEditKind.read && event.target.equals(target);
  if (!isReadOfTarget) {
    return undefined;
  }
  if (event.content === undefined) {
    return undefined;
  }
  const source = bashCatIds.has(event.changeId.toString()) ? BeaconSource.bashCat : BeaconSource.readEcho;
  return { source, instant: event.instant, content: event.content };
}

function listReadCandidates(target: Path, sessionFile: Path, records: TranscriptRecord[]): BeaconCandidate[] {
  const bashCatIds = collectBashCatIds(records, sessionFile);
  const candidates: BeaconCandidate[] = [];
  for (const event of readSessionEditEvents(sessionFile)) {
    const candidate = buildReadCandidate(event, target, bashCatIds);
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function listFileHistoryCandidates(target: Path, records: TranscriptRecord[], sources: SourceEntry[] | undefined, overrides: PathOverrides): BeaconCandidate[] {
  const reader = buildSidecarReader(records, overrides, sources);
  const resolveBackupPath = buildBackupPathResolver(records, overrides, sources);
  if (reader === undefined) {
    return [];
  }
  if (resolveBackupPath === undefined) {
    return [];
  }
  const beacons = collectTargetSnapshotBeaconNodes(records, target, reader, resolveBackupPath);
  return buildCandidatesFromBeacons(BeaconSource.fileHistory, beacons);
}

function listSessionCandidates(target: Path, sessionFile: Path, sources: SourceEntry[] | undefined, overrides: PathOverrides): BeaconCandidate[] {
  const { records } = loadTranscript(sessionFile.toString(), undefined, true);
  return [...listReadCandidates(target, sessionFile, records), ...listFileHistoryCandidates(target, records, sources, overrides)];
}

export function listBeaconCandidates(target: Path, sessionFiles: Path[], repoPath: Path, sources: SourceEntry[] | undefined, overrides: PathOverrides): BeaconCandidate[] {
  const candidates: BeaconCandidate[] = [];
  for (const sessionFile of sessionFiles) {
    candidates.push(...listSessionCandidates(target, sessionFile, sources, overrides));
  }
  candidates.push(...buildCandidatesFromBeacons(BeaconSource.commit, collectCommitBeaconNodes(repoPath, target)));
  return candidates.sort(compareCandidateInstants);
}
