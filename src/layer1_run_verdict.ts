// Task 358 part N: verified, mismatch, or no proof for one changed file of a replayed run.

import { WireConfidence, WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { BeaconSource, type BeaconCandidate } from "./layer1_beacon_candidates.ts";
import type { LayerEditEvent } from "./layer1_edit_events.ts";
import type { Path } from "./structures/domain.ts";

// A later script run of the path enters as a write event.
export type ChangeEvent = Pick<LayerEditEvent, "kind" | "target" | "instant">;

const SOURCE_TIE_RANK: Record<BeaconSource, number> = {
  [BeaconSource.fileHistory]: 0,
  [BeaconSource.readEcho]: 1,
  [BeaconSource.bashCat]: 2,
  [BeaconSource.commit]: 3,
};
const WORST_FIRST: WireConfidence[] = [WireConfidence.mismatch, WireConfidence.injectedUnverified, WireConfidence.verified];

function compareBeacons(left: BeaconCandidate, right: BeaconCandidate): number {
  const byInstant = left.instant.getTime() - right.instant.getTime();
  if (byInstant !== 0) {
    return byInstant;
  }
  return SOURCE_TIE_RANK[left.source] - SOURCE_TIE_RANK[right.source];
}

export function findNearestBeaconAfter(candidates: BeaconCandidate[], runInstant: Date): BeaconCandidate | undefined {
  let nearest: BeaconCandidate | undefined;
  for (const candidate of candidates) {
    const isAfterRun = candidate.instant.getTime() > runInstant.getTime();
    const isFirstAfterRun = isAfterRun && nearest === undefined;
    const isCloserThanNearest = isAfterRun && nearest !== undefined && compareBeacons(candidate, nearest) < 0;
    const isNewNearest = isFirstAfterRun || isCloserThanNearest;
    if (isNewNearest) {
      nearest = candidate;
    }
  }
  return nearest;
}

export function isChangeBetween(target: Path, runInstant: Date, beaconInstant: Date, editEvents: ChangeEvent[]): boolean {
  for (const event of editEvents) {
    const isChangeKind = event.kind === WireEditKind.edit || event.kind === WireEditKind.write;
    const isAfterRun = event.instant.getTime() > runInstant.getTime();
    const isBeforeBeacon = event.instant.getTime() < beaconInstant.getTime();
    const isChangeBetweenInstants = isChangeKind && isAfterRun && isBeforeBeacon;
    const isSameTarget = event.target.equals(target);
    const isTargetChange = isChangeBetweenInstants && isSameTarget;
    if (isTargetChange) {
      return true;
    }
  }
  return false;
}

export function computeFileVerdict(replayedContent: string, beacon: BeaconCandidate | undefined, isChangeBetween: boolean): WireConfidence | undefined {
  const hasNoBeacon = beacon === undefined;
  const isUnverifiable = hasNoBeacon || isChangeBetween;
  if (isUnverifiable) {
    return undefined;
  }
  return beacon.content === replayedContent ? WireConfidence.verified : WireConfidence.mismatch;
}

function containsConfidence(confidences: WireConfidence[], wanted: WireConfidence): boolean {
  for (const confidence of confidences) {
    if (confidence === wanted) {
      return true;
    }
  }
  return false;
}

export function findWorstConfidence(confidences: WireConfidence[]): WireConfidence | undefined {
  for (const confidence of confidences) {
    const isRanked = containsConfidence(WORST_FIRST, confidence);
    if (!isRanked) {
      throw new Error(`no worst-of rank for confidence ${confidence}`);
    }
  }
  for (const worst of WORST_FIRST) {
    const isPresent = containsConfidence(confidences, worst);
    if (isPresent) {
      return worst;
    }
  }
  return undefined;
}
