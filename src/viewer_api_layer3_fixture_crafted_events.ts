// Layer 3 crafted Read/Edit/Write events, listed oldest first per path.

import { applyHunksToLines } from "./layer1_edit_hunks.ts";
import { listTemplateLines } from "./viewer_api_layer1_fixture_content.ts";
import {
  buildEditEvent,
  buildReadEvent,
  buildStaleEditEvent,
  buildWriteEvent,
  type FixtureEvent,
} from "./viewer_api_layer3_fixture_data.ts";

const INDEX_PATH = "src/index.ts";
const UTIL_PATH = "src/util.ts";
const DISPATCHER_PATH = "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts";

// Events are listed oldest first per path, so the tracked state is each event's true base.
export function buildCraftedEvents(): FixtureEvent[] {
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
    stateByPath.set(path, applyHunksToLines(base, event.hunks!));
  };
  const addStaleEdit = (path: string, at: string, session: string, line: number, index: number): void => {
    const base = readState(path);
    const event = buildStaleEditEvent({ path, at, session, line }, base, index);
    events.push(event);
    stateByPath.set(path, applyHunksToLines(base, event.hunks!));
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
