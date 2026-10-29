// Regression guards for four recurring Layer 1 visual failure modes.  Checks: overlapping bubbles, label overprint, bucket-title leak, off-screen jumps.

import type { Measured, StateGeometry } from "./geometry.ts";
import { findBucketTitleLabels } from "./bucket-title-assertions.ts";
import { formatMeasured, isOverlapping, type Violation } from "./violation-geometry.ts";

// 1.6x clears line-height rounding without reaching a genuine second line.
const WRAP_HEIGHT_RATIO = 1.6;

function compareByLeftEdge(left: Measured, right: Measured): number {
  return left.box.x - right.box.x;
}

// Collisions after `index`, stopping when candidates start past its right edge (requires x-sorted input).
function listCollisionsAfter(sorted: Measured[], index: number): [Measured, Measured][] {
  const current = sorted[index]!;
  const pairs: [Measured, Measured][] = [];
  for (let other = index + 1; other < sorted.length; other += 1) {
    const candidate = sorted[other]!;
    if (candidate.box.x >= current.box.x + current.box.w) {
      break;
    }
    const isColliding = isOverlapping(current.box, candidate.box);
    if (isColliding) {
      pairs.push([current, candidate]);
    }
  }
  return pairs;
}

// Every colliding pair in a set of rects.
function listCollidingPairs(measured: Measured[]): [Measured, Measured][] {
  const sorted = [...measured].sort(compareByLeftEdge);
  const pairs: [Measured, Measured][] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    pairs.push(...listCollisionsAfter(sorted, index));
  }
  return pairs;
}

// Rule 1: overlapping nodes per lane (tasks 251/259) or bubbles (tasks 247-249).
export function findOverlaps(geometry: StateGeometry): Violation[] {
  const byLane = new Map<number, Measured[]>();
  for (const node of geometry.nodes) {
    byLane.set(node.laneIndex, [...(byLane.get(node.laneIndex) ?? []), node]);
  }
  const pairs: [Measured, Measured][] = [];
  for (const laneNodes of byLane.values()) {
    pairs.push(...listCollidingPairs(laneNodes));
  }
  pairs.push(...listCollidingPairs(geometry.fileboxes));
  const violations: Violation[] = [];
  for (const [left, right] of pairs) {
    violations.push({
      rule: "overlapping-nodes",
      state: geometry.state,
      detail: `${formatMeasured(left)} overlaps ${formatMeasured(right)}`,
    });
  }
  return violations;
}

function findOverlappedNeighbour(label: Measured, owner: Measured, fileboxes: Measured[]): Measured | undefined {
  for (const box of fileboxes) {
    const isNeighbour = box !== owner;
    const isHit = isNeighbour && isOverlapping(label.box, box.box);
    if (isHit) {
      return box;
    }
  }
  return undefined;
}

// Rule 2: wrapped or spilled commit-row text; `.nlabel` is nowrap/unclipped so long text overprints neighbours.
export function findTextOverflow(geometry: StateGeometry): Violation[] {
  const wrapped: Violation[] = [];
  for (const label of geometry.labels) {
    const isWrapped = label.lineHeight > 0 && label.box.h > label.lineHeight * WRAP_HEIGHT_RATIO;
    if (isWrapped) {
      wrapped.push({
        rule: "wrapped-commit-row",
        state: geometry.state,
        detail: `${formatMeasured(label)} is ${label.box.h}px tall against a ${label.lineHeight}px line`,
      });
    }
  }
  const boxesByPath = new Map<string, Measured>();
  for (const box of geometry.fileboxes) {
    boxesByPath.set(box.ownerPath ?? box.text, box);
  }
  const spilled: Violation[] = [];
  for (const label of geometry.labels) {
    const owner = boxesByPath.get(label.ownerPath ?? label.text);
    if (owner === undefined) {
      continue;
    }
    const staysInsideOwner = label.box.x + label.box.w <= owner.box.x + owner.box.w;
    if (staysInsideOwner) {
      continue;
    }
    const hit = findOverlappedNeighbour(label, owner, geometry.fileboxes);
    if (hit === undefined) {
      continue;
    }
    spilled.push({
      rule: "commit-row-overprints-neighbour",
      state: geometry.state,
      detail: `${formatMeasured(label)} runs past its bubble and paints over ${hit.ownerPath ?? hit.text}`,
    });
  }
  return [...wrapped, ...spilled];
}

// Rule 4: verify the lit bubble is within the scroll pane's visible viewport.
export function findOffscreenLandings(geometry: StateGeometry): Violation[] {
  const pane = geometry.scroller;
  const where = `${pane.x},${pane.y} ${pane.w}x${pane.h}`;
  const violations: Violation[] = [];
  for (const landed of geometry.found) {
    const isInsidePane = isOverlapping(landed.box, pane);
    if (!isInsidePane) {
      violations.push({
        rule: "landing-outside-viewport",
        state: geometry.state,
        detail: `${formatMeasured(landed)} is outside the timeline pane at ${where}`,
      });
    }
  }
  return violations;
}

// Every rule against one state.
export function listStateViolations(geometry: StateGeometry): Violation[] {
  return [
    ...findOverlaps(geometry),
    ...findTextOverflow(geometry),
    ...findBucketTitleLabels(geometry),
    ...findOffscreenLandings(geometry),
  ];
}
