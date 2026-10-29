// Layer 3 fixture replay: each Read/Edit/Write event's base and target bytes, and its confidence, computed once.

import { WireConfidence, WireEditKind, WireEditSide, type WireEditOf, type WireEditsViewOf } from "../webapp/layer1-wire-edits.ts";
import { applyHunksToLines } from "./layer1_edit_hunks.ts";
import { LAYER1_PROGRESS_LABEL_READING_EDITS } from "./layer1_edits_wire.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { listTemplateLines } from "./viewer_api_layer1_fixture_content.ts";
import { buildSessionFile, buildSessionId, findTitleAt, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { EDITS, findFixtureEvent, listFixtureEvents, type FixtureEvent } from "./viewer_api_layer3_fixture_data.ts";
import { findEventIndex, findNextReadIndex, isEveryHunkMatching, readEventContent } from "./viewer_api_layer3_fixture_lookup.ts";

// Task 355: label moved to layer1_edits_wire.ts; re-point 343's tests, then drop this line.
// export { LAYER1_PROGRESS_LABEL_READING_EDITS } from "./layer1_edits_wire.ts";
// export const LAYER1_PROGRESS_LABEL_READING_EDITS = "reading Edit/Write events";

export interface ReplayedEvent { base: string[]; target: string[]; confidence: WireConfidence; }

interface EventStates { base: string[]; target: string[]; isMatched: boolean; }

type FixtureEditsView = WireEditsViewOf<Date, Path, Uuid>;
type FixtureWireEdit = Omit<WireEditOf<Date, Path, Uuid>, "axisPx">;

const statesByChangeId = new Map<string, EventStates>();
const replayedByChangeId = new Map<string, ReplayedEvent>();

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
  const index = findEventIndex(events, event.changeId);
  let states: EventStates;
  if (event.kind === WireEditKind.read) {
    states = { base: readEventContent(event), target: readEventContent(event), isMatched: true };
  }
  else if (event.kind === WireEditKind.write) {
    states = { base: computeBase(events, index), target: readEventContent(event), isMatched: true };
  }
  else {
    const base = computeBase(events, index);
    const isMatched = isEveryHunkMatching(base, event.hunks!);
    states = { base, target: applyHunksToLines(base, event.hunks!), isMatched };
  }
  statesByChangeId.set(event.changeId, states);
  return states;
}

function computeEditConfidence(event: FixtureEvent): WireConfidence {
  const states = computeStates(event);
  if (!states.isMatched) {
    return WireConfidence.derived;
  }
  const events = listFixtureEvents(event.path);
  const nextReadIndex = findNextReadIndex(events, findEventIndex(events, event.changeId) + 1);
  if (nextReadIndex === -1) {
    return WireConfidence.verified;
  }
  const beforeRead = events[nextReadIndex - 1]!;
  const isSame = computeStates(beforeRead).target.join("\n") === readEventContent(events[nextReadIndex]!).join("\n");
  return isSame ? WireConfidence.verified : WireConfidence.derived;
}

export function computeFixtureReplay(event: FixtureEvent): ReplayedEvent {
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
  const replayed = computeFixtureReplay(event);
  const isBase = side === WireEditSide.base;
  const isUnknownSide = !isBase && side !== WireEditSide.target;
  if (isUnknownSide) {
    throw new Error(`side must be base or target, got ${side}`);
  }
  return {
    content: (isBase ? replayed.base : replayed.target).join("\n"),
    title: findTitleAt(event.session, event.line),
    record: buildFixtureRecord(event),
  };
}

function buildWireEdit(event: FixtureEvent): FixtureWireEdit {
  return {
    instant: new Date(parseMs(event.at)),
    kind: event.kind,
    changeId: new Uuid(event.changeId),
    confidence: computeFixtureReplay(event).confidence,
    sessionId: buildSessionId(event.session),
    sessionFile: buildSessionFile(event.session),
    line: event.line,
  };
}

// One progress line per session file; pairs join by relative path, as the fixture stores events.
export function buildFixtureEditsPayload(writeNdjsonLine: (value: unknown) => void): FixtureEditsView {
  const sessionList: string[] = [];
  for (const event of EDITS) {
    sessionList.push(event.session);
  }
  const sessionFiles = [...new Set(sessionList)];
  const wireByChangeId = new Map<string, FixtureWireEdit>();
  for (let done = 0; done < sessionFiles.length; done += 1) {
    writeNdjsonLine({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_READING_EDITS,
      current: done + 1, total: sessionFiles.length });
    for (const event of EDITS) {
      if (event.session === sessionFiles[done]) {
        wireByChangeId.set(event.changeId, buildWireEdit(event));
      }
    }
  }
  const pathList: string[] = [];
  for (const event of EDITS) {
    pathList.push(event.path);
  }
  const pairs: FixtureEditsView["pairs"] = [];
  for (const path of new Set(pathList)) {
    const edits: FixtureWireEdit[] = [];
    for (const event of listFixtureEvents(path)) {
      edits.push(wireByChangeId.get(event.changeId)!);
    }
    pairs.push({ path: new Path(path), edits });
  }
  return { pairs };
}
