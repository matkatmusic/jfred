// The violation record and the box helpers every visual assertion rule shares.

import type { Box, Measured } from "./geometry.ts";

// Sub-pixel slack: adjacent borders legitimately touch, so only overlaps wider than this count.
const OVERLAP_EPSILON = 0.5;

export interface Violation {
  rule: string;
  state: string;
  detail: string;
}

export function isOverlapping(left: Box, right: Box): boolean {
  const overlapsHorizontally = left.x + left.w - OVERLAP_EPSILON > right.x && right.x + right.w - OVERLAP_EPSILON > left.x;
  const overlapsVertically = left.y + left.h - OVERLAP_EPSILON > right.y && right.y + right.h - OVERLAP_EPSILON > left.y;
  return overlapsHorizontally && overlapsVertically;
}

export function formatMeasured(measured: Measured): string {
  const name = measured.ownerPath ?? measured.path ?? measured.text;
  const { x, y, w, h } = measured.box;
  return `${name} "${measured.text.trim()}" at ${x},${y} ${w}x${h}`;
}
