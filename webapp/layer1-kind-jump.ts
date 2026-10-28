// The show row arrows jump the timeline to the nearest node of one kind along the time axis.

import { getRequiredElementById } from "./app-dom.ts";
import { markLandedElement, moveToUncoveredCentre } from "./layer1-find-file.ts";
import { isKindHidden, registerKindBoxToggle } from "./layer1-kind-filter.ts";
import { classifyNodeKind } from "./layer1-node-kind.ts";
import { KindJumpDirection, ShowRowKind } from "./layer1-show-row.ts";

// Within this a node counts as the one already landed on, so a second click never sticks on it.
const SAME_POSITION_EPSILON_PX = 1;

const DIRECTION_SIGN: Record<KindJumpDirection, number> = {
  [KindJumpDirection.previous]: -1,
  [KindJumpDirection.next]: 1,
};

// Until the pane scrolls, the next click steps from the landed node, which is off the pane's centre.
let landed: { node: HTMLElement; scrollTop: number } | undefined;

interface MeasuredNode {
  node: HTMLElement;
  centerY: number;
}

function readCenterY(element: HTMLElement): number {
  const box = element.getBoundingClientRect();
  return box.top + box.height / 2;
}

function readAnchorY(): number {
  const pane = getRequiredElementById("timelines");
  if (landed === undefined) {
    return readCenterY(pane);
  }
  const stageHoldsLandedNode = getRequiredElementById("stage").contains(landed.node);
  const paneIsUnscrolled = landed.scrollTop === pane.scrollTop;
  const isLandedNodeCurrent = stageHoldsLandedNode && paneIsUnscrolled;
  if (isLandedNodeCurrent) {
    return readCenterY(landed.node);
  }
  return readCenterY(pane);
}

function listKindNodes(kind: ShowRowKind): MeasuredNode[] {
  const measuredNodes: MeasuredNode[] = [];
  for (const node of getRequiredElementById("stage").querySelectorAll<HTMLElement>(".node, .bnode")) {
    const isRequestedKind = classifyNodeKind(node) === kind;
    if (isRequestedKind) {
      measuredNodes.push({ node, centerY: readCenterY(node) });
    }
  }
  return measuredNodes;
}

function findNearestInDirection(nodes: MeasuredNode[], anchorY: number, direction: KindJumpDirection): HTMLElement | undefined {
  const sign = DIRECTION_SIGN[direction];
  let nearest: MeasuredNode | undefined;
  for (const candidate of nodes) {
    const isPastAnchor = (candidate.centerY - anchorY) * sign > SAME_POSITION_EPSILON_PX;
    if (isPastAnchor) {
      const isNearer = nearest === undefined || (candidate.centerY - nearest.centerY) * sign < 0;
      if (isNearer) {
        nearest = candidate;
      }
    }
  }
  return nearest?.node;
}

function readArrowKind(arrow: HTMLElement): ShowRowKind {
  for (const kind of Object.values(ShowRowKind)) {
    const isArrowKind = kind === arrow.dataset["jumpKind"];
    if (isArrowKind) {
      return kind;
    }
  }
  throw new Error(`No show row kind matches data-jump-kind "${arrow.dataset["jumpKind"]}"`);
}

function readArrowDirection(arrow: HTMLElement): KindJumpDirection {
  for (const direction of Object.values(KindJumpDirection)) {
    const isArrowDirection = direction === arrow.dataset["jump"];
    if (isArrowDirection) {
      return direction;
    }
  }
  throw new Error(`No jump direction matches data-jump "${arrow.dataset["jump"]}"`);
}

function triggerJumpFromArrowClick(event: MouseEvent): void {
  const arrow = (event.target as HTMLElement).closest<HTMLElement>("button[data-jump-kind]");
  if (arrow === null) {
    return;
  }
  const target = findNearestInDirection(listKindNodes(readArrowKind(arrow)), readAnchorY(), readArrowDirection(arrow));
  if (target === undefined) {
    return;
  }
  // Same landing as a ruler tick click.
  moveToUncoveredCentre(target);
  markLandedElement(target);
  landed = { node: target, scrollTop: getRequiredElementById("timelines").scrollTop };
  refreshKindJumpArrows();
}

// Run after every stage render, box toggle and scroll; assigned, not added, so a re-render never stacks listeners.
export function refreshKindJumpArrows(): void {
  const showRow = getRequiredElementById("show-row");
  showRow.onclick = triggerJumpFromArrowClick;
  getRequiredElementById("timelines").onscroll = refreshKindJumpArrows;
  const anchorY = readAnchorY();
  const nodesByKind = new Map<ShowRowKind, MeasuredNode[]>();
  for (const arrow of showRow.querySelectorAll<HTMLButtonElement>("button[data-jump-kind]")) {
    const kind = readArrowKind(arrow);
    const isKindMeasured = nodesByKind.has(kind);
    if (!isKindMeasured) {
      nodesByKind.set(kind, isKindHidden(kind) ? [] : listKindNodes(kind));
    }
    arrow.disabled = findNearestInDirection(nodesByKind.get(kind)!, anchorY, readArrowDirection(arrow)) === undefined;
  }
}

registerKindBoxToggle(refreshKindJumpArrows);
