// Task 357: the trunk rail and named merge checks of the Layer 5 real checks.

import { WireRewindKind } from "../../webapp/layer1-wire-branches.ts";
import { isNear, JOT_MERGE_PATH, REVENG_MERGE_PATH, type DrawnLane, type PageFacts } from "./layer5-real-facts.ts";
import { reportCheck } from "./mockup-checks.ts";

const DETAIL_LIMIT = 3;

export function validateTrunkRails(page: PageFacts): void {
  let areRailsSolid = true;
  for (const bubble of page.bubbles) {
    if (bubble.trunkRailStyle !== "solid") {
      areRailsSolid = false;
    }
  }
  reportCheck("l5-real every trunk rail in a lane bubble is solid", areRailsSolid);
  if (page.plainRailLeft === null) {
    console.log("SKIP  l5-real every pair on the page has lanes, so no branch-less bubble to compare the trunk rail x with");
    return;
  }
  let areRailsAligned = true;
  const railLefts: number[] = [];
  for (const bubble of page.bubbles) {
    const isAligned = isNear(bubble.trunkRailLeft, page.plainRailLeft);
    if (!isAligned) {
      areRailsAligned = false;
    }
  }
  for (const bubble of page.bubbles.slice(0, DETAIL_LIMIT)) {
    railLefts.push(bubble.trunkRailLeft);
  }
  reportCheck("l5-real the trunk rail sits at the same x as in a branch-less bubble", areRailsAligned, { plain: page.plainRailLeft, bubbles: railLefts });
}

export function validateNamedMerge(lanes: DrawnLane[], isJot: boolean, isReveng: boolean): void {
  const namedPath = isJot ? JOT_MERGE_PATH : isReveng ? REVENG_MERGE_PATH : undefined;
  const named: DrawnLane[] = [];
  for (const lane of lanes) {
    if (lane.path === namedPath) {
      named.push(lane);
    }
  }
  if (named.length > 0) {
    let hasMergeLane = false;
    const rewindKinds: string[] = [];
    for (const lane of named) {
      if (lane.facts.mergeBottom !== null) {
        hasMergeLane = true;
      }
      rewindKinds.push(lane.payload.rewindKind);
    }
    reportCheck(`l5-real ${namedPath} has a lane with a merge elbow`, hasMergeLane, rewindKinds);
    return;
  }
  console.log(`l5-real ${namedPath ?? "demo"} is not drawn, so check 7 derives from the payload`);
  let rejoiningCount = 0;
  let codeCount = 0;
  let doRejoiningLanesMerge = true;
  let doCodeLanesStayUnmerged = true;
  for (const lane of lanes) {
    if (lane.payload.rejoinAt !== undefined) {
      rejoiningCount += 1;
      if (lane.facts.mergeBottom === null) {
        doRejoiningLanesMerge = false;
      }
    }
    if (lane.payload.rewindKind === WireRewindKind.code) {
      codeCount += 1;
      if (lane.facts.mergeBottom !== null) {
        doCodeLanesStayUnmerged = false;
      }
    }
  }
  reportCheck("l5-real every drawn lane with rejoinAt shows a merge elbow", doRejoiningLanesMerge, rejoiningCount);
  reportCheck("l5-real no drawn code lane shows a merge elbow", doCodeLanesStayUnmerged, codeCount);
}
