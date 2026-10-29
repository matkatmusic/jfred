// Task 355 step 4: replay one path's ordered events into base, target and confidence, in memory.

import { WireConfidence, WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { applyHunksToLines, isHunkMatchingBase } from "./layer1_edit_hunks.ts";
import type { LayerEditEvent } from "./layer1_edit_events.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";

export interface ReplayedEditNode { base: string[]; target: string[]; confidence: WireConfidence; }

// The one disk-touching seam: the pre-edit lines from a file-history backup, or undefined when none exists.
export type SeedBaseReader = (event: LayerEditEvent) => string[] | undefined;

type EventHunks = NonNullable<LayerEditEvent["hunks"]>;

function readEventContent(event: LayerEditEvent): string[] {
  if (event.content === undefined) {
    throw new Error(`event ${event.changeId.toString()} has no content`);
  }
  return splitLines(event.content);
}

function readEventHunks(event: LayerEditEvent): EventHunks {
  if (event.hunks === undefined) {
    throw new Error(`edit ${event.changeId.toString()} has no hunks`);
  }
  return event.hunks;
}

function validateAllHunksMatch(base: string[], hunks: EventHunks): boolean {
  for (const hunk of hunks) {
    const isMatch = isHunkMatchingBase(base, hunk);
    if (!isMatch) {
      return false;
    }
  }
  return true;
}

function computeEditNode(event: LayerEditEvent, previous: string[], readSeedBase: SeedBaseReader): ReplayedEditNode {
  const hunks = readEventHunks(event);
  const previousMatches = validateAllHunksMatch(previous, hunks);
  if (previousMatches) {
    return { base: previous, target: applyHunksToLines(previous, hunks), confidence: WireConfidence.verified };
  }
  const seed = readSeedBase(event);
  const hasSeed = seed !== undefined;
  const seedMatches = hasSeed && validateAllHunksMatch(seed, hunks);
  if (seedMatches) {
    return { base: seed, target: applyHunksToLines(seed, hunks), confidence: WireConfidence.reseeded };
  }
  return { base: previous, target: applyHunksToLines(previous, hunks), confidence: WireConfidence.derived };
}

function computeEventNode(event: LayerEditEvent, previous: string[], readSeedBase: SeedBaseReader): ReplayedEditNode {
  if (event.kind === WireEditKind.read) {
    const lines = readEventContent(event);
    return { base: lines, target: lines, confidence: WireConfidence.verified };
  }
  if (event.kind === WireEditKind.write) {
    return { base: previous, target: readEventContent(event), confidence: WireConfidence.verified };
  }
  return computeEditNode(event, previous, readSeedBase);
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

function isReadDisagreeing(events: readonly LayerEditEvent[], index: number, nodes: Map<string, ReplayedEditNode>): boolean {
  const lastTarget = nodes.get(events[index - 1]!.changeId.toString())!.target;
  const lastText = lastTarget.join("\n");
  const readText = readEventContent(events[index]!).join("\n");
  return lastText !== readText;
}

// Events are pre-sorted; a read is a beacon that resets the running state.
export function computePathReplay(events: readonly LayerEditEvent[], readSeedBase: SeedBaseReader): Map<string, ReplayedEditNode> {
  const nodes = new Map<string, ReplayedEditNode>();
  let previous: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const isRead = event.kind === WireEditKind.read;
    const hasSegment = index > segmentStart;
    const closesSegment = isRead && hasSegment;
    const disagrees = closesSegment && isReadDisagreeing(events, index, nodes);
    if (disagrees) {
      markSegmentDerived(events, segmentStart, index, nodes);
    }
    if (isRead) {
      segmentStart = index + 1;
    }
    const node = computeEventNode(event, previous, readSeedBase);
    nodes.set(event.changeId.toString(), node);
    previous = node.target;
  }
  return nodes;
}
