// Layer 3 fixture data: crafted Read/Edit/Write events and the pure hunk helpers the bulk generator reuses.

import { WireEditKind } from "../webapp/layer1-wire.ts";
import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { listTemplateLines } from "./viewer_api_layer1_fixture_content.ts";
import { parseMs } from "./viewer_api_layer1_fixture_data.ts";

export interface FixtureEventSpec { path: string; at: string; session: string; line: number; }

export interface FixtureEvent extends FixtureEventSpec {
  changeId: string;
  kind: WireEditKind;
  hunks?: StructuredPatchHunk[];
  content?: string[];
  expectDerived?: true;
}

const CONTEXT_LINES = 3;
const INDEX_PATH = "src/index.ts";
const UTIL_PATH = "src/util.ts";
const DISPATCHER_PATH = "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts";

let eventCount = 0;

function buildChangeId(): string {
  eventCount += 1;
  return `toolu_fixture_${String(eventCount).padStart(3, "0")}`;
}

export function buildReplaceHunk(base: string[], index: number, newLine: string): StructuredPatchHunk {
  const start = Math.max(0, index - CONTEXT_LINES);
  const end = Math.min(base.length, index + CONTEXT_LINES + 1);
  const lines: string[] = [];
  for (let at = start; at < end; at += 1) {
    if (at === index) {
      lines.push(`-${base[at]}`, `+${newLine}`);
    }
    else {
      lines.push(` ${base[at]}`);
    }
  }
  return { oldStart: start + 1, oldLines: end - start, newStart: start + 1, newLines: end - start, lines };
}

// A hunk matches when every context and removed row equals the base line at its position.
export function matchesBase(base: string[], hunk: StructuredPatchHunk): boolean {
  let cursor = hunk.oldStart - 1;
  for (const row of hunk.lines) {
    const isOldSide = !row.startsWith("+");
    if (!isOldSide) {
      continue;
    }
    if (base[cursor] !== row.slice(1)) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

// Best effort when the hunk disagrees with the base: positions decide, the base keeps its own text.
export function applyHunkLines(base: string[], hunks: StructuredPatchHunk[]): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart - 1;
    result.push(...base.slice(cursor, hunkStart));
    cursor = hunkStart;
    for (const row of hunk.lines) {
      if (row.startsWith("+")) {
        result.push(row.slice(1));
        continue;
      }
      if (row.startsWith(" ")) {
        result.push(base[cursor]!);
      }
      cursor += 1;
    }
  }
  result.push(...base.slice(cursor));
  return result;
}

function buildBaseEvent(kind: WireEditKind, spec: FixtureEventSpec): FixtureEvent {
  return { ...spec, changeId: buildChangeId(), kind };
}

export function buildReadEvent(spec: FixtureEventSpec, content: string[]): FixtureEvent {
  return { ...buildBaseEvent(WireEditKind.read, spec), content };
}

export function buildWriteEvent(spec: FixtureEventSpec, content: string[]): FixtureEvent {
  return { ...buildBaseEvent(WireEditKind.write, spec), content };
}

function buildHunkEvent(spec: FixtureEventSpec, hunkBase: string[], index: number, newLine: string): FixtureEvent {
  return { ...buildBaseEvent(WireEditKind.edit, spec), hunks: [buildReplaceHunk(hunkBase, index, newLine)] };
}

export function buildEditEvent(spec: FixtureEventSpec, base: string[], index: number): FixtureEvent {
  return buildHunkEvent(spec, base, index, `${base[index]}  // edited`);
}

// The hunk was cut against a base whose neighbouring line differs, so it cannot match the true base.
export function buildStaleEditEvent(spec: FixtureEventSpec, base: string[], index: number): FixtureEvent {
  const staleBase = [...base];
  const contextIndex = index > 0 ? index - 1 : index + 1;
  staleBase[contextIndex] += " (stale)";
  return { ...buildHunkEvent(spec, staleBase, index, `${base[index]}  // edited`), expectDerived: true };
}

// Events are listed oldest first per path, so the tracked state is each event's true base.
function buildCraftedEvents(): FixtureEvent[] {
  const events: FixtureEvent[] = [];
  const stateByPath = new Map<string, string[]>();
  const readState = (path: string): string[] => stateByPath.get(path) ?? listTemplateLines(path);
  const addRead = (path: string, at: string, session: string, line: number): void => {
    events.push(buildReadEvent({ path, at, session, line }, readState(path)));
  };
  const addEdit = (path: string, at: string, session: string, line: number, index: number): void => {
    const base = readState(path);
    const event = buildEditEvent({ path, at, session, line }, base, index);
    events.push(event);
    stateByPath.set(path, applyHunkLines(base, event.hunks!));
  };
  const addStaleEdit = (path: string, at: string, session: string, line: number, index: number): void => {
    const base = readState(path);
    const event = buildStaleEditEvent({ path, at, session, line }, base, index);
    events.push(event);
    stateByPath.set(path, applyHunkLines(base, event.hunks!));
  };
  const addWrite = (path: string, at: string, session: string, line: number): void => {
    const body = ["// rewritten whole file", ...readState(path).slice(1)];
    events.push(buildWriteEvent({ path, at, session, line }, body));
    stateByPath.set(path, body);
  };
  addRead(INDEX_PATH, "2026-06-01T08:46:00Z", "0f3c9a7e.jsonl", 30);
  addEdit(INDEX_PATH, "2026-06-01T08:52:00Z", "0f3c9a7e.jsonl", 44, 5);
  addRead(UTIL_PATH, "2026-06-01T14:10:00Z", "b21d84c5.jsonl", 50);
  addEdit(UTIL_PATH, "2026-06-01T14:15:00Z", "b21d84c5.jsonl", 58, 5);
  addRead(DISPATCHER_PATH, "2026-06-03T09:00:00Z", "b21d84c5.jsonl", 260);
  addStaleEdit(DISPATCHER_PATH, "2026-06-03T09:10:00Z", "b21d84c5.jsonl", 280, 5);
  addEdit(INDEX_PATH, "2026-06-03T17:30:00Z", "b21d84c5.jsonl", 410, 5);
  addWrite(DISPATCHER_PATH, "2026-07-23T20:00:00Z", "d4a06b8f.jsonl", 70);
  addRead(INDEX_PATH, "2026-07-24T07:40:00Z", "d4a06b8f.jsonl", 150);
  addEdit(INDEX_PATH, "2026-07-24T07:45:00Z", "d4a06b8f.jsonl", 160, 7);
  addRead(UTIL_PATH, "2026-07-24T07:50:00Z", "d4a06b8f.jsonl", 170);
  addEdit(UTIL_PATH, "2026-07-24T07:55:00Z", "d4a06b8f.jsonl", 180, 5);
  return events;
}

// Bulk rows are appended here by buildBulkFixture when the layer 2 data module loads.
export const EDITS: FixtureEvent[] = buildCraftedEvents();

function compareByInstant(left: FixtureEvent, right: FixtureEvent): number {
  return parseMs(left.at) - parseMs(right.at);
}

export function listFixtureEvents(path: string): FixtureEvent[] {
  return EDITS.filter((event) => event.path === path).sort(compareByInstant);
}

export function findFixtureEvent(changeId: string): FixtureEvent {
  const found = EDITS.find((event) => event.changeId === changeId);
  if (found === undefined) {
    throw new Error(`no fixture event ${changeId}`);
  }
  return found;
}
