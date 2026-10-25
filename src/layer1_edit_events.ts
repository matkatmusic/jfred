// Task 355 step 2: one session transcript becomes Edit/Write/Read events that carry the wire identity.

import { statSync } from "node:fs";
import { WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { collectReadEchoNodes } from "./layered_anchor.ts";
import { collectBashCatBeacons } from "./layer1_cat_beacons.ts";
import { getRecordSource, loadTranscript } from "./parse/loadTranscript.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { BlockType, EventKind } from "./structures/vocabulary.ts";
import { LayeredNodeKind } from "./structures/vocabulary_views.ts";

export interface LayerEditEvent {
  changeId: Uuid;
  kind: WireEditKind;
  target: Path;
  instant: Date;
  sessionId: Uuid;
  sessionFile: Path;
  line: number | undefined;
  hunks?: StructuredPatchHunk[];
  content?: string;
}

type CachedEvents = { mtimeMs: number; events: LayerEditEvent[] };

// ponytail: unbounded, fine for a local viewer
const eventsBySessionFile = new Map<string, CachedEvents>();

function indexResultLinesByToolUseId(records: TranscriptRecord[]): Map<string, number | undefined> {
  const lineById = new Map<string, number | undefined>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      if (block.type === BlockType.tool_result) {
        lineById.set(block.tool_use_id.toString(), getRecordSource(record)?.lineNumber);
      }
    }
  }
  return lineById;
}

export function compareEditEvents(left: LayerEditEvent, right: LayerEditEvent): number {
  const byInstant = left.instant.getTime() - right.instant.getTime();
  if (byInstant !== 0) {
    return byInstant;
  }
  const bySessionFile = left.sessionFile.toString().localeCompare(right.sessionFile.toString());
  if (bySessionFile !== 0) {
    return bySessionFile;
  }
  return (left.line ?? 0) - (right.line ?? 0);
}

function buildSessionEditEvents(sessionFile: Path): LayerEditEvent[] {
  const { records } = loadTranscript(sessionFile.toString(), undefined, true);
  const sessionId = findSessionId(records);
  if (sessionId === undefined) {
    throw new Error(`no session id in ${sessionFile.toString()}`);
  }
  const lineById = indexResultLinesByToolUseId(records);
  const identity = { sessionId, sessionFile };
  const events: LayerEditEvent[] = [];
  for (const event of extractFileEvents(records)) {
    const line = lineById.get(event.changeId.toString());
    if (event.kind === EventKind.edit) {
      events.push({ ...identity, changeId: event.changeId, kind: WireEditKind.edit, target: event.target, instant: event.timestamp, line, hunks: event.hunks });
    }
    if (event.kind === EventKind.write) {
      events.push({ ...identity, changeId: event.changeId, kind: WireEditKind.write, target: event.target, instant: event.timestamp, line, content: event.content });
    }
  }
  for (const placement of collectReadEchoNodes(records, sessionFile)) {
    if (placement.node.kind === LayeredNodeKind.beacon) {
      events.push({ ...identity, changeId: placement.changeId, kind: WireEditKind.read, target: placement.target, instant: placement.instant, line: lineById.get(placement.changeId.toString()), content: placement.node.content });
    }
  }
  for (const beacon of collectBashCatBeacons(records, sessionFile)) {
    events.push({ ...identity, changeId: beacon.changeId, kind: WireEditKind.read, target: beacon.target, instant: beacon.instant, line: beacon.evidence.line, content: beacon.content });
  }
  return events.sort(compareEditEvents);
}

export function readSessionEditEvents(sessionFile: Path): LayerEditEvent[] {
  const key = sessionFile.toString();
  const mtimeMs = statSync(key).mtimeMs;
  const cached = eventsBySessionFile.get(key);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    return cached.events;
  }
  const events = buildSessionEditEvents(sessionFile);
  eventsBySessionFile.set(key, { mtimeMs, events });
  return events;
}
