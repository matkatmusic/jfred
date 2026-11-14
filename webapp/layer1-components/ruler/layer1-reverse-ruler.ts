// The reverse walk's gutter rows: one per state, at the offset its node uses, never merged.

import { WireReverseKind, type WireReverseState } from "../../layer1-wire-reverse.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import { formatInstantLabel, type RulerRow } from "./layer1-ruler-rows.ts";

const DISK_NOW_RULER_TEXT = "now";

function buildReverseRulerRow(state: WireReverseState): RulerRow {
  const axisPx = state.index * RULER_NODE_ROW_PIXELS;
  if (state.instant === undefined) {
    if (state.kind !== WireReverseKind.DiskNow) {
      throw new Error(`reverse state ${state.index} (${state.kind}) has no instant`);
    }
    return { axisPx, text: DISK_NOW_RULER_TEXT, eventCount: 1, axisPxList: [axisPx], instants: [] };
  }
  return { axisPx, text: formatInstantLabel(state.instant), eventCount: 1, axisPxList: [axisPx], instants: [state.instant] };
}

export function listReverseRulerRows(states: WireReverseState[]): RulerRow[] {
  const rows: RulerRow[] = [];
  for (const state of states) {
    rows.push(buildReverseRulerRow(state));
  }
  return rows;
}
