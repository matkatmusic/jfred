// Task 355 step 4: replay one path's ordered events into base, target and confidence, in memory.

import { WireConfidence, WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { applyHunksToLines, checkHunkMatchesBase } from "./layer1_edit_hunks.ts";
import type { LayerEditEvent } from "./layer1_edit_events.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";

export interface ReplayedEditNode { base: string[]; target: string[]; confidence: WireConfidence; }

// The one disk-touching seam: the pre-edit lines from a file-history backup, or undefined when none exists.
export type SeedBaseReader = (event: LayerEditEvent) => string[] | undefined;

function requireContent(event: LayerEditEvent): string[] {
  if (event.content === undefined) {
    throw new Error(`event ${event.changeId.toString()} has no content`);
  }
  return splitLines(event.content);
}

function requireHunks(event: LayerEditEvent): NonNullable<LayerEditEvent["hunks"]> {
  if (event.hunks === undefined) {
    throw new Error(`edit ${event.changeId.toString()} has no hunks`);
  }
  return event.hunks;
}

function replayEdit(event: LayerEditEvent, previous: string[], readSeedBase: SeedBaseReader): ReplayedEditNode {
  const hunks = requireHunks(event);
  if (hunks.every((hunk) => checkHunkMatchesBase(previous, hunk))) {
    return { base: previous, target: applyHunksToLines(previous, hunks), confidence: WireConfidence.verified };
  }
  const seed = readSeedBase(event);
  if (seed !== undefined && hunks.every((hunk) => checkHunkMatchesBase(seed, hunk))) {
    return { base: seed, target: applyHunksToLines(seed, hunks), confidence: WireConfidence.reseeded };
  }
  return { base: previous, target: applyHunksToLines(previous, hunks), confidence: WireConfidence.derived };
}

function replayEvent(event: LayerEditEvent, previous: string[], readSeedBase: SeedBaseReader): ReplayedEditNode {
  if (event.kind === WireEditKind.read) {
    const lines = requireContent(event);
    return { base: lines, target: lines, confidence: WireConfidence.verified };
  }
  if (event.kind === WireEditKind.write) {
    return { base: previous, target: requireContent(event), confidence: WireConfidence.verified };
  }
  return replayEdit(event, previous, readSeedBase);
}

// A later read that disagrees with the replayed bytes means every edit since the last read is only derived.
function markSegmentDerived(events: readonly LayerEditEvent[], from: number, to: number, nodes: Map<string, ReplayedEditNode>): void {
  for (let index = from; index < to; index += 1) {
    const key = events[index]!.changeId.toString();
    if (events[index]!.kind === WireEditKind.edit) {
      nodes.set(key, { ...nodes.get(key)!, confidence: WireConfidence.derived });
    }
  }
}

// Events are pre-sorted; a read is a beacon that resets the running state.
export function replayPathEvents(events: readonly LayerEditEvent[], readSeedBase: SeedBaseReader): Map<string, ReplayedEditNode> {
  const nodes = new Map<string, ReplayedEditNode>();
  let previous: string[] = [];
  let segmentStart = 0;
  events.forEach((event, index) => {
    if (event.kind === WireEditKind.read && index > segmentStart) {
      const lastTarget = nodes.get(events[index - 1]!.changeId.toString())!.target;
      if (lastTarget.join("\n") !== requireContent(event).join("\n")) {
        markSegmentDerived(events, segmentStart, index, nodes);
      }
    }
    if (event.kind === WireEditKind.read) {
      segmentStart = index + 1;
    }
    const node = replayEvent(event, previous, readSeedBase);
    nodes.set(event.changeId.toString(), node);
    previous = node.target;
  });
  return nodes;
}
