// Layer 5 checks on the facts of one file bubble: trunk, rails, elbows, widening, and dot rows.

import { reportCheck } from "./mockup-checks.ts";
import { formatTickStamp, isNear, TOLERANCE_PX, type BubbleFacts, type LaneFacts, type Rect } from "./layer5-bubble-facts.ts";

const BNODE_OPACITY = 0.38;

type BranchNode = LaneFacts["bnodes"][number];

export function validateTrunkAndRails(label: string, bubble: BubbleFacts, plainRailLeft: number): void {
  reportCheck(`L5 ${label}: the trunk rail is solid`, bubble.trunkRailStyle === "solid", bubble.trunkRailStyle);
  reportCheck(`L5 ${label}: the trunk rail sits where it sits in a bubble with no branches`,
    isNear(bubble.trunkRailLeft, plainRailLeft), { bubble: bubble.trunkRailLeft, plain: plainRailLeft });
  let areRailsDashedAndDim = true;
  const railDetails: [string, number][] = [];
  const branchOpacities: number[] = [];
  for (const lane of bubble.lanes) {
    railDetails.push([lane.railStyle, lane.railOpacity]);
    const isDashed = lane.railStyle === "dashed";
    const isDim = lane.railOpacity < 1;
    const isDashedAndDim = isDashed && isDim;
    if (!isDashedAndDim) {
      areRailsDashedAndDim = false;
    }
    for (const node of lane.bnodes) {
      branchOpacities.push(node.opacity);
    }
  }
  reportCheck(`L5 ${label}: every branch rail is dashed and dimmer than 1`, areRailsDashedAndDim, railDetails);
  let areBranchDotsDim = branchOpacities.length > 0;
  for (const opacity of branchOpacities) {
    const isDim = isNear(opacity, BNODE_OPACITY);
    if (!isDim) {
      areBranchDotsDim = false;
    }
  }
  reportCheck(`L5 ${label}: every branch dot has opacity .38`, areBranchDotsDim, branchOpacities);
  let areTrunkNodesOpaque = bubble.trunkOpacities.length > 0;
  for (const opacity of bubble.trunkOpacities) {
    if (opacity !== 1) {
      areTrunkNodesOpaque = false;
    }
  }
  reportCheck(`L5 ${label}: every visible trunk node has opacity 1`, areTrunkNodesOpaque, bubble.trunkOpacities);
}

export function validateElbows(label: string, bubble: BubbleFacts): void {
  const trunkLeft = bubble.rect.left + bubble.trunkRailLeft;
  let areElbowsPlaced = true;
  const elbowDetails: object[] = [];
  for (const lane of bubble.lanes) {
    elbowDetails.push({ elbow: lane.elbow, fork: lane.forkCentreY, railCx: lane.rail.cx, style: lane.elbowTopStyle, trunkLeft });
    const isPlaced = isNear(lane.elbow.top, lane.forkCentreY) && isNear(lane.elbow.left, trunkLeft)
      && isNear(lane.elbow.right, lane.rail.cx) && lane.elbowTopStyle === "dashed";
    if (!isPlaced) {
      areElbowsPlaced = false;
    }
  }
  reportCheck(`L5 ${label}: every split elbow starts level with its forkAt ruler tick, at the trunk rail, and ends at its lane, and is dashed`,
    areElbowsPlaced, elbowDetails);
}

function isInsideBubble(rect: Rect, bubbleRect: Rect): boolean {
  return rect.left >= bubbleRect.left - TOLERANCE_PX && rect.right <= bubbleRect.right + TOLERANCE_PX;
}

export function validateWidening(bubble: BubbleFacts, utilBubble: BubbleFacts): void {
  let areLanesInside = true;
  const laneDetails: [number, number[]][] = [];
  const xs: number[] = [];
  for (const lane of bubble.lanes) {
    xs.push(lane.laneX);
    const labelRights: number[] = [];
    let areLabelsInside = true;
    for (const labelRect of lane.labelRects) {
      labelRights.push(labelRect.right);
      const isLabelInside = isInsideBubble(labelRect, bubble.rect);
      if (!isLabelInside) {
        areLabelsInside = false;
      }
    }
    laneDetails.push([lane.laneX, labelRights]);
    const isLaneInside = lane.laneX >= bubble.rect.left && lane.laneX <= bubble.rect.right;
    const isLaneAndLabelsInside = isLaneInside && areLabelsInside;
    if (!isLaneAndLabelsInside) {
      areLanesInside = false;
    }
  }
  reportCheck("L5 index.ts: every lane and every branch label sits inside the bubble rect", areLanesInside,
    { bubble: bubble.rect, lanes: laneDetails });
  let areLanesSpaced = true;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! - xs[i - 1]! < bubble.laneW - TOLERANCE_PX) {
      areLanesSpaced = false;
    }
  }
  reportCheck("L5 index.ts: lane x positions differ by at least the lane width", areLanesSpaced, { xs, laneW: bubble.laneW });
  reportCheck("L5 index.ts: the bubble is wider than the src/util.ts bubble",
    bubble.rect.right - bubble.rect.left > utilBubble.rect.right - utilBubble.rect.left, [bubble.rect, utilBubble.rect]);
}

export function validateDotRows(lanes: LaneFacts[], ticks: { text: string; cy: number }[]): void {
  const branchNodes: BranchNode[] = [];
  const laneCentres: { elbowTop: number; railBottom: number; ys: number[] }[] = [];
  for (const lane of lanes) {
    const ys: number[] = [];
    for (const node of lane.bnodes) {
      branchNodes.push(node);
      ys.push(node.cy);
    }
    laneCentres.push({ elbowTop: lane.elbow.top, railBottom: lane.rail.bottom, ys });
  }
  const unmatched: BranchNode[] = [];
  for (const node of branchNodes) {
    let hasTickRow = false;
    for (const tick of ticks) {
      const isSameInstant = tick.text.startsWith(formatTickStamp(node.instant));
      const isSameRow = isNear(tick.cy, node.cy);
      const isMatchingTick = isSameInstant && isSameRow;
      if (isMatchingTick) {
        hasTickRow = true;
      }
    }
    if (!hasTickRow) {
      unmatched.push(node);
    }
  }
  reportCheck("L5 every branch dot sits level with the ruler tick of its own instant",
    branchNodes.length === 6 && unmatched.length === 0, unmatched);
  let areDotsOnRails = true;
  for (const lane of laneCentres) {
    for (let i = 0; i < lane.ys.length; i++) {
      const cy = lane.ys[i]!;
      const isOnRail = cy >= lane.elbowTop && cy <= lane.railBottom + TOLERANCE_PX;
      const isBelowPrevious = i === 0 || cy > lane.ys[i - 1]!;
      const isPlaced = isOnRail && isBelowPrevious;
      if (!isPlaced) {
        areDotsOnRails = false;
      }
    }
  }
  reportCheck("L5 every branch dot sits on its own lane rail, below the split elbow, at its own row", areDotsOnRails, laneCentres);
}
