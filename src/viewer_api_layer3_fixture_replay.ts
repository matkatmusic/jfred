// Layer 3 fixture replay: each Read/Edit/Write event's base and target bytes, and its confidence, computed once.

import { WireConfidence, WireEditKind, WireEditSide, type WireEditOf, type WireEditsViewOf } from "../webapp/layer1-wire.ts";
import { applyHunksToLines, checkHunkMatchesBase } from "./layer1_edit_hunks.ts";
import { LAYER1_PROGRESS_LABEL_READING_EDITS } from "./layer1_edits_wire.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { listTemplateLines } from "./viewer_api_layer1_fixture_content.ts";
import { buildSessionFile, buildSessionId, findTitleAt, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { EDITS, findFixtureEvent, listFixtureEvents, type FixtureEvent } from "./viewer_api_layer3_fixture_data.ts";

// Task 355: the label moved to layer1_edits_wire.ts. 343's tests still import it from here; re-point them, then drop this line.
// export { LAYER1_PROGRESS_LABEL_READING_EDITS } from "./layer1_edits_wire.ts";
// export const LAYER1_PROGRESS_LABEL_READING_EDITS = "reading Edit/Write events";

export interface ReplayedEvent { base: string[]; target: string[]; confidence: WireConfidence; }

interface EventStates { base: string[]; target: string[]; isMatched: boolean; }

type FixtureEditsView = WireEditsViewOf<Date, Path, Uuid>;
type FixtureWireEdit = Omit<WireEditOf<Date, Path, Uuid>, "axisPx">;

const statesByChangeId = new Map<string, EventStates>();
const replayedByChangeId = new Map<string, ReplayedEvent>();

function requireContent(event: FixtureEvent): string[] {
  if (event.content === undefined) {
    throw new Error(`fixture event ${event.changeId} has no content`);
  }
  return event.content;
}

function computeBase(events: FixtureEvent[], index: number): string[] {
  const predecessor = events[index - 1];
  return predecessor === undefined ? listTemplateLines(events[index]!.path) : computeStates(predecessor).target;
}

// Looks backward only, so a chain never waits on a later event.
function computeStates(event: FixtureEvent): EventStates {
  const known = statesByChangeId.get(event.changeId);
  if (known !== undefined) {
    return known;
  }
  const events = listFixtureEvents(event.path);
  const index = events.findIndex((candidate) => candidate.changeId === event.changeId);
  let states: EventStates;
  if (event.kind === WireEditKind.read) {
    states = { base: requireContent(event), target: requireContent(event), isMatched: true };
  }
  else if (event.kind === WireEditKind.write) {
    states = { base: computeBase(events, index), target: requireContent(event), isMatched: true };
  }
  else {
    const base = computeBase(events, index);
    const isMatched = event.hunks!.every((hunk) => checkHunkMatchesBase(base, hunk));
    states = { base, target: applyHunksToLines(base, event.hunks!), isMatched };
  }
  statesByChangeId.set(event.changeId, states);
  return states;
}

function computeEditConfidence(event: FixtureEvent): WireConfidence {
  if (!computeStates(event).isMatched) {
    return WireConfidence.derived;
  }
  const events = listFixtureEvents(event.path);
  const later = events.slice(events.findIndex((candidate) => candidate.changeId === event.changeId) + 1);
  const nextRead = later.find((candidate) => candidate.kind === WireEditKind.read);
  if (nextRead === undefined) {
    return WireConfidence.verified;
  }
  const beforeRead = events[events.indexOf(nextRead) - 1]!;
  const isSame = computeStates(beforeRead).target.join("\n") === requireContent(nextRead).join("\n");
  return isSame ? WireConfidence.verified : WireConfidence.derived;
}

export function replayFixtureEvent(event: FixtureEvent): ReplayedEvent {
  const known = replayedByChangeId.get(event.changeId);
  if (known !== undefined) {
    return known;
  }
  const states = computeStates(event);
  const confidence = event.kind === WireEditKind.edit ? computeEditConfidence(event) : WireConfidence.verified;
  const replayed = { base: states.base, target: states.target, confidence };
  replayedByChangeId.set(event.changeId, replayed);
  return replayed;
}

// A transcript-shaped record: the tool_use block and the result's structuredPatch.
export function buildFixtureRecord(event: FixtureEvent): object {
  return {
    type: "assistant",
    sessionId: buildSessionId(event.session).toString(),
    message: { content: [{ type: "tool_use", id: event.changeId, name: event.kind, input: { file_path: event.path } }] },
    toolUseResult: { type: event.kind, filePath: event.path, structuredPatch: event.hunks ?? [] },
  };
}

export function readFixtureEditFile(changeId: string, side: string): { content: string; title: string; record: object } {
  const event = findFixtureEvent(changeId);
  const replayed = replayFixtureEvent(event);
  if (side !== WireEditSide.base && side !== WireEditSide.target) {
    throw new Error(`side must be base or target, got ${side}`);
  }
  return {
    content: (side === WireEditSide.base ? replayed.base : replayed.target).join("\n"),
    title: findTitleAt(event.session, event.line),
    record: buildFixtureRecord(event),
  };
}

function buildWireEdit(event: FixtureEvent): FixtureWireEdit {
  return {
    instant: new Date(parseMs(event.at)),
    kind: event.kind,
    changeId: new Uuid(event.changeId),
    confidence: replayFixtureEvent(event).confidence,
    sessionId: buildSessionId(event.session),
    sessionFile: buildSessionFile(event.session),
    line: event.line,
  };
}

// One progress line per session file; pairs join by relative path, as the fixture stores events.
export function buildFixtureEditsPayload(writeNdjsonLine: (value: unknown) => void): FixtureEditsView {
  const sessionFiles = [...new Set(EDITS.map((event) => event.session))];
  const wireByChangeId = new Map<string, FixtureWireEdit>();
  for (let done = 0; done < sessionFiles.length; done += 1) {
    writeNdjsonLine({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_READING_EDITS,
      current: done + 1, total: sessionFiles.length });
    for (const event of EDITS.filter((candidate) => candidate.session === sessionFiles[done])) {
      wireByChangeId.set(event.changeId, buildWireEdit(event));
    }
  }
  const paths = [...new Set(EDITS.map((event) => event.path))];
  return { pairs: paths.map((path) => ({
    path: new Path(path),
    edits: listFixtureEvents(path).map((event) => wireByChangeId.get(event.changeId)!),
  })) };
}
