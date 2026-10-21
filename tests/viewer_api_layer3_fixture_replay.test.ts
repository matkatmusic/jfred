import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/viewer_api_layer2_fixture_data.ts";
import { listTemplateLines } from "../src/viewer_api_layer1_fixture_content.ts";
import { EDITS, listFixtureEvents } from "../src/viewer_api_layer3_fixture_data.ts";
import {
  LAYER1_PROGRESS_LABEL_READING_EDITS, buildFixtureEditsPayload, buildFixtureRecord, readFixtureEditFile, replayFixtureEvent,
} from "../src/viewer_api_layer3_fixture_replay.ts";

const INDEX_PATH = "src/index.ts";
const DISPATCHER_PATH = "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts";

test("a clean first edit is verified and changes only its own line", () => {
  const edit = listFixtureEvents(INDEX_PATH)[1]!;
  const replayed = replayFixtureEvent(edit);
  assert.equal(replayed.confidence, "verified");
  assert.deepEqual(replayed.base, listTemplateLines(INDEX_PATH));
  assert.equal(replayed.target.length, replayed.base.length);
  assert.ok(replayed.target[5]!.endsWith("// edited"));
});

test("the stale dispatcher edit is derived", () => {
  const stale = listFixtureEvents(DISPATCHER_PATH).find((event) => event.expectDerived === true)!;
  assert.equal(replayFixtureEvent(stale).confidence, "derived");
});

test("a chained edit starts from its predecessor's target with no beacon between", () => {
  const events = listFixtureEvents(INDEX_PATH);
  const chained = replayFixtureEvent(events[2]!);
  assert.equal(chained.base, replayFixtureEvent(events[1]!).target);
  assert.equal(chained.confidence, "verified");
});

test("a Read beacon verifies the edits before it", () => {
  const events = listFixtureEvents(INDEX_PATH);
  const read = events.find((event) => event.kind === "read" && event.at.startsWith("2026-07-24"))!;
  const replayed = replayFixtureEvent(read);
  assert.equal(replayed.base, replayed.target);
  assert.equal(replayed.confidence, "verified");
  assert.equal(replayed.target.join("\n"), replayFixtureEvent(events[2]!).target.join("\n"));
});

test("a Write replaces the file with its body and starts from the previous state", () => {
  const events = listFixtureEvents(DISPATCHER_PATH);
  const write = events.find((event) => event.kind === "write")!;
  const replayed = replayFixtureEvent(write);
  assert.deepEqual(replayed.target, write.content);
  assert.equal(replayed.base, replayFixtureEvent(events[events.indexOf(write) - 1]!).target);
  assert.equal(replayed.confidence, "verified");
});

test("an event is computed once: the same object comes back", () => {
  const event = EDITS[1]!;
  assert.equal(replayFixtureEvent(event), replayFixtureEvent(event));
});

test("the file payload answers the chosen side, the session title and a transcript-shaped record", () => {
  const edit = listFixtureEvents("src/util.ts")[1]!;
  const base = readFixtureEditFile(edit.changeId, "base");
  const target = readFixtureEditFile(edit.changeId, "target");
  assert.notEqual(base.content, target.content);
  assert.equal(target.title, "extract the trim helper");
  assert.equal(JSON.stringify(target.record), JSON.stringify(buildFixtureRecord(edit)));
  assert.ok(JSON.stringify(target.record).includes("structuredPatch"));
  assert.ok(JSON.stringify(target.record).includes(edit.changeId));
});

test("the file payload refuses a side that is neither base nor target", () => {
  assert.throws(() => readFixtureEditFile(EDITS[0]!.changeId, "middle"), /side must be base or target/);
});

test("the edits payload streams one progress line per session file, then groups events by path", () => {
  const lines: { kind: string; label: string; current: number; total: number }[] = [];
  const payload = buildFixtureEditsPayload((line) => lines.push(line as never));
  const sessionCount = new Set(EDITS.map((event) => event.session)).size;
  assert.equal(lines.length, sessionCount);
  assert.deepEqual(lines.map((line) => line.current), lines.map((_, index) => index + 1));
  assert.ok(lines.every((line) => line.kind === "progress" && line.label === LAYER1_PROGRESS_LABEL_READING_EDITS
    && line.total === sessionCount));
  const util = payload.pairs.find((pair) => pair.path.toString() === "src/util.ts")!;
  assert.equal(util.edits.length, 4);
  assert.deepEqual(util.edits.map((edit) => edit.instant.getTime()), util.edits.map((edit) => edit.instant.getTime()).sort());
  assert.equal(payload.pairs.reduce((total, pair) => total + pair.edits.length, 0), EDITS.length);
});

test("the dispatcher's stale edit travels as derived on the wire", () => {
  const payload = buildFixtureEditsPayload(() => {});
  const dispatcher = payload.pairs.find((pair) => pair.path.toString() === DISPATCHER_PATH)!;
  assert.deepEqual(dispatcher.edits.map((edit) => edit.confidence), ["verified", "derived", "verified"]);
});
