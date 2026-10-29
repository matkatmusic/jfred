// Task 355: pure readers over the real /api/layer1-edits payload for the Layer 3 real-server checks.

import { WireConfidence, type WireEditsView } from "../../webapp/layer1-wire-edits.ts";

const COUNTER_LABEL = /\d+ \/ \d+/;

export type WireEdit = WireEditsView["pairs"][number]["edits"][number];

export function listAllEdits(payload: WireEditsView): WireEdit[] {
  const edits: WireEdit[] = [];
  for (const pair of payload.pairs)
    edits.push(...pair.edits);
  return edits;
}

export function listEditsOnPaths(payload: WireEditsView, paths: Set<string>): WireEdit[] {
  const edits: WireEdit[] = [];
  for (const pair of payload.pairs) {
    const isOnPath = paths.has(pair.path);
    if (isOnPath)
      edits.push(...pair.edits);
  }
  return edits;
}

export function containsCounterLabel(labels: string[]): boolean {
  for (const label of labels) {
    const isCounter = COUNTER_LABEL.test(label);
    if (isCounter)
      return true;
  }
  return false;
}

export function findUncertainEdit(payload: WireEditsView): WireEdit | undefined {
  for (const edit of listAllEdits(payload)) {
    if (edit.confidence !== WireConfidence.verified)
      return edit;
  }
  return undefined;
}
