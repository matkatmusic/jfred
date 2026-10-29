import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/viewer_api_layer2_fixture_data.ts";
import { listTemplateLines } from "../src/viewer_api_layer1_fixture_content.ts";
import { listFixtureEvents } from "../src/viewer_api_layer3_fixture_data.ts";
import {
  findEventIndex, findNextReadIndex, isEveryHunkMatching, readEventContent,
} from "../src/viewer_api_layer3_fixture_lookup.ts";

const INDEX_PATH = "src/index.ts";

test("findEventIndex returns the position of a change id, or -1", () => {
  const events = listFixtureEvents(INDEX_PATH);
  assert.equal(findEventIndex(events, events[2]!.changeId), 2);
  assert.equal(findEventIndex(events, "missing"), -1);
});

test("findNextReadIndex returns the first read at or after the start index", () => {
  const events = listFixtureEvents(INDEX_PATH);
  const first = events.findIndex((event) => event.kind === "read");
  assert.equal(findNextReadIndex(events, 0), first);
  assert.equal(findNextReadIndex(events, events.length), -1);
});

test("readEventContent returns the content and throws when there is none", () => {
  const events = listFixtureEvents(INDEX_PATH);
  const read = events.find((event) => event.kind === "read")!;
  assert.equal(readEventContent(read), read.content);
  const edit = events.find((event) => event.kind === "edit")!;
  assert.throws(() => readEventContent(edit), /has no content/);
});

test("isEveryHunkMatching is true for a clean edit and false against a different base", () => {
  const edit = listFixtureEvents(INDEX_PATH).find((event) => event.kind === "edit")!;
  const base = listTemplateLines(INDEX_PATH);
  assert.equal(isEveryHunkMatching(base, edit.hunks!), true);
  assert.equal(isEveryHunkMatching(base.map(() => "other"), edit.hunks!), false);
});
