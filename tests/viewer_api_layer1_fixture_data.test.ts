import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionFile, buildSessionId, findTitleAt, getBasename } from "../src/viewer_api_layer1_fixture_data.ts";

test("findTitleAt picks the title range that holds the line", () => {
  assert.equal(findTitleAt("b21d84c5.jsonl", 100), "extract the trim helper");
  assert.equal(findTitleAt("b21d84c5.jsonl", 300), "dispatch through one table");
  assert.equal(findTitleAt("7ce50a19.jsonl", 5), "untitled session");
});

test("session ids and files are stable and share the file name", () => {
  assert.equal(buildSessionId("0f3c9a7e.jsonl").toString(), "fixture-0f3c9a7e");
  assert.equal(getBasename(buildSessionFile("0f3c9a7e.jsonl").toString()), "0f3c9a7e.jsonl");
});
