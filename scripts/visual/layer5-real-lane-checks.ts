// Task 357: the lane checks of the Layer 5 real checks.

import { containsMergeTarget, findRejoinCy, findTickCy, isNear, type DrawnLane, type PageFacts } from "./layer5-real-facts.ts";
import { reportCheck } from "./mockup-checks.ts";

const BNODE_OPACITY = 0.38;
const DETAIL_LIMIT = 3;

export function validateLanes(lanes: DrawnLane[], page: PageFacts): void {
  const badSplit: DrawnLane[] = [];
  const badMergePresence: DrawnLane[] = [];
  const badRejoin: DrawnLane[] = [];
  const badKept: DrawnLane[] = [];
  const badRail: DrawnLane[] = [];
  const opacities: number[] = [];
  const trunkOpacities: number[] = [];
  for (const lane of lanes) {
    const isSplitLevel = isNear(lane.facts.splitTop, findTickCy(page, lane.payload.forkAt));
    const isSplitDashed = lane.facts.splitStyle === "dashed";
    const isBadSplit = !isSplitLevel || !isSplitDashed;
    if (isBadSplit) {
      badSplit.push(lane);
    }
    const isMergeDrawn = lane.facts.mergeBottom !== null;
    const isMergeExpected = containsMergeTarget(lane.payload);
    if (isMergeDrawn !== isMergeExpected) {
      badMergePresence.push(lane);
    }
    const hasRejoin = lane.payload.rejoinAt !== undefined;
    if (hasRejoin) {
      const isAtRejoin = isNear(lane.facts.mergeBottom ?? undefined, findRejoinCy(lane, page));
      if (!isAtRejoin) {
        badRejoin.push(lane);
      }
    }
    const isKeptToEnd = lane.payload.keptToEnd === true;
    if (isKeptToEnd) {
      const trunkCys: number[] = [];
      for (const node of lane.bubble.trunk) {
        trunkCys.push(node.cy);
      }
      const isAtLowestDot = isNear(lane.facts.mergeBottom ?? undefined, Math.max(...trunkCys, lane.facts.bnodeMaxCy));
      if (!isAtLowestDot) {
        badKept.push(lane);
      }
    }
    const isRailDashed = lane.facts.railStyle === "dashed";
    const isRailDim = lane.facts.railOpacity < 1;
    const isGoodRail = isRailDashed && isRailDim;
    if (!isGoodRail) {
      badRail.push(lane);
    }
    for (const value of lane.facts.bnodeOpacities) {
      opacities.push(value);
    }
    for (const node of lane.bubble.trunk) {
      trunkOpacities.push(node.opacity);
    }
  }
  const splitDetail: unknown[] = [];
  for (const lane of badSplit.slice(0, DETAIL_LIMIT)) {
    splitDetail.push([lane.path, lane.payload.forkAt, lane.facts.splitTop, findTickCy(page, lane.payload.forkAt)]);
  }
  reportCheck("l5-real every split elbow is dashed and level with the ruler tick of its forkAt", badSplit.length === 0, splitDetail);
  const mergeDetail: unknown[] = [];
  for (const lane of badMergePresence.slice(0, DETAIL_LIMIT)) {
    mergeDetail.push([lane.path, lane.payload.rewindKind, lane.payload.rejoinAt, lane.payload.keptToEnd]);
  }
  reportCheck("l5-real a merge elbow is drawn exactly when the lane has rejoinAt or keptToEnd", badMergePresence.length === 0, mergeDetail);
  const rejoinDetail: unknown[] = [];
  for (const lane of badRejoin.slice(0, DETAIL_LIMIT)) {
    rejoinDetail.push([lane.path, lane.payload.rejoinAt, lane.facts.mergeBottom, findRejoinCy(lane, page)]);
  }
  reportCheck("l5-real every merge elbow with rejoinAt ends level with that trunk node", badRejoin.length === 0, rejoinDetail);
  const keptDetail: unknown[] = [];
  for (const lane of badKept.slice(0, DETAIL_LIMIT)) {
    keptDetail.push([lane.path, lane.facts.mergeBottom]);
  }
  reportCheck("l5-real every keptToEnd merge elbow ends level with the lowest dot of its bubble", badKept.length === 0, keptDetail);
  reportCheck("l5-real every branch rail is dashed and dimmer than 1", badRail.length === 0, badRail.slice(0, DETAIL_LIMIT));
  let areDotsDimmed = opacities.length > 0;
  for (const value of opacities) {
    const isDimmed = isNear(value, BNODE_OPACITY);
    if (!isDimmed) {
      areDotsDimmed = false;
    }
  }
  reportCheck("l5-real every branch dot has opacity about .38", areDotsDimmed, opacities.slice(0, 5));
  let areTrunkNodesOpaque = trunkOpacities.length > 0;
  for (const value of trunkOpacities) {
    if (value !== 1) {
      areTrunkNodesOpaque = false;
    }
  }
  reportCheck("l5-real every visible trunk node in those bubbles has opacity 1", areTrunkNodesOpaque, trunkOpacities.slice(0, 5));
}
