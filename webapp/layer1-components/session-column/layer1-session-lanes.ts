// Pure lane packing for the session column: sessions that do not overlap share one lane.

export const LANE_FIRST_X_PX = 18;
// export const LANE_STEP_PX = 28;
// Dots are 14px wide: a 17px step leaves a 3px gap between neighbors.
export const LANE_STEP_PX = 17;
export const LANE_END_PAD_PX = 22;
export const DOT_WIDTH_PX = 14;
export const DOT_STACK_STEP_PX = 14;
export const BRACKET_OFFSET_PX = 15;
export const BRACKET_WIDTH_PX = 6;
// task 912: bracket room is off; slots replace lane widths.
// Clear room left of a lane's first dot for its pair bracket: the bracket and the 2px before the dot.
// export const BRACKET_ROOM_PX = BRACKET_OFFSET_PX - DOT_WIDTH_PX / 2;
export const MIN_LANE_GAP_PX = 14;
export const BAR_RESERVE_STEP_PX = 9;
export const BAR_RESERVE_EXTRA_PX = 4;

export interface SessionSpan {
  firstPx: number;
  lastPx: number;
}

// A session's first and last dot on the axis, for lanes and lines.
export interface SessionPixelSpan extends SessionSpan {
  sessionId: string;
}

function listIndexesByFirstPx(spans: readonly SessionSpan[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < spans.length; index += 1) {
    indexes.push(index);
  }
  function compareFirstPx(left: number, right: number): number {
    return spans[left]!.firstPx - spans[right]!.firstPx;
  }
  return indexes.sort(compareFirstPx);
}

// Returns the first lane that ends a gap before firstPx, else a new lane.
function findFreeLane(laneEnds: readonly number[], firstPx: number): number {
  for (const [lane, end] of laneEnds.entries()) {
    const isFree = end + MIN_LANE_GAP_PX <= firstPx;
    if (isFree) {
      return lane;
    }
  }
  return laneEnds.length;
}

// Returns one lane index per input span, in input order.
export function computeSessionLanes(spans: readonly SessionSpan[]): number[] {
  const lanes: number[] = new Array<number>(spans.length);
  const laneEnds: number[] = [];
  for (const index of listIndexesByFirstPx(spans)) {
    const span = spans[index]!;
    const lane = findFreeLane(laneEnds, span.firstPx);
    laneEnds[lane] = span.lastPx;
    lanes[index] = lane;
  }
  return lanes;
}

export function computeBarReservePx(pickedCount: number): number {
  if (pickedCount === 0) {
    return 0;
  }
  return pickedCount * BAR_RESERVE_STEP_PX + BAR_RESERVE_EXTRA_PX;
}

export function computeLaneX(lane: number, reservePx: number): number {
  return reservePx + LANE_FIRST_X_PX + lane * LANE_STEP_PX;
}

// task 912: slots replace lane widths; the lane is the slot.
// function computeSessionLaneAdvancePx(widthSlots: number): number {
//   return LANE_STEP_PX + BRACKET_ROOM_PX + (widthSlots - 1) * DOT_STACK_STEP_PX;
// }

// task 912: slots replace lane widths; the lane is the slot.
// // laneWidthSlots is given only in session layout; undefined keeps the time-layout numbers.
// export function computeLaneX(lane: number, reservePx: number, laneWidthSlots?: readonly number[]): number {
//   if (laneWidthSlots === undefined) {
//     return reservePx + LANE_FIRST_X_PX + lane * LANE_STEP_PX;
//   }
//   let laneX = reservePx + LANE_FIRST_X_PX;
//   for (let before = 0; before < lane; before += 1) {
//     laneX += computeSessionLaneAdvancePx(laneWidthSlots[before]!);
//   }
//   return laneX;
// }

export function computeTrackWidthPx(laneCount: number, reservePx: number): number {
  return computeLaneX(laneCount - 1, reservePx) + LANE_END_PAD_PX;
}

// task 912: slots replace lane widths; the lane is the slot.
// export function computeTrackWidthPx(laneCount: number, reservePx: number, laneWidthSlots?: readonly number[]): number {
//   const lastLaneX = computeLaneX(laneCount - 1, reservePx, laneWidthSlots);
//   if (laneWidthSlots === undefined) {
//     return lastLaneX + LANE_END_PAD_PX;
//   }
//   return lastLaneX + (laneWidthSlots[laneCount - 1]! - 1) * DOT_STACK_STEP_PX + LANE_END_PAD_PX;
// }

// task 912: slots replace lane widths; the lane is the slot.
// One width per lane: the widest session placed in it (a lane is at least 1 slot).
// export function computeLaneWidthSlots(lanes: readonly number[], sessionWidthSlots: readonly number[]): number[] {
//   const laneWidthSlots: number[] = new Array<number>(Math.max(0, ...lanes) + 1).fill(1);
//   for (const [index, lane] of lanes.entries()) {
//     laneWidthSlots[lane] = Math.max(laneWidthSlots[lane]!, sessionWidthSlots[index]!);
//   }
//   return laneWidthSlots;
// }
