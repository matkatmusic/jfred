// Turn builders shared by the conversation and file graphs (spec 40).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { extractRenderableEvents } from "./reconstruction_renderable.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import type { GraphTurn } from "./reconstruction_graph.ts";

// Bijective base-26 so letters never run out past Z.
export function formatColumnLabel(index: number): string {
  let label = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

// The one place the union's path field is resolved, so both builders agree.
function getTurnTarget(event: FileEvent): Path {
  const isMove = event.kind === EventKind.rename || event.kind === EventKind.copy;
  if (isMove) {
    return event.to;
  }
  return event.target;
}

// The "?" placeholder should never appear: every event was lettered over these records.
export function convertEventToGraphTurn(event: FileEvent, letters: Map<string, string>): GraphTurn {
  return {
    letter: letters.get(event.changeId.toString()) ?? "?",
    kind: event.kind,
    target: getTurnTarget(event),
    changeId: event.changeId,
    timestamp: event.timestamp,
  };
}

export function convertRecordsToGraphTurns(
  records: TranscriptRecord[],
  accepted: Set<string>,
  letters: Map<string, string>,
): GraphTurn[] {
  const turns: GraphTurn[] = [];
  for (const event of extractRenderableEvents(records, accepted)) {
    turns.push(convertEventToGraphTurn(event, letters));
  }
  return turns;
}
