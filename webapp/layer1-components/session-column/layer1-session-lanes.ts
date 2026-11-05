// Pure lane packing for the session column: sessions that do not overlap share one lane.

export const LANE_FIRST_X_PX = 18;
// export const LANE_STEP_PX = 28;
// Dots are 14px wide: a 17px step leaves a 3px gap between neighbors.
export const LANE_STEP_PX = 17;
export const LANE_END_PAD_PX = 22;
export const MIN_LANE_GAP_PX = 14;
export const BAR_RESERVE_STEP_PX = 9;
export const BAR_RESERVE_EXTRA_PX = 4;

export interface SessionSpan {
  firstPx: number;
  lastPx: number;
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

export function computeTrackWidthPx(laneCount: number, reservePx: number): number {
  return computeLaneX(laneCount - 1, reservePx) + LANE_END_PAD_PX;
}
