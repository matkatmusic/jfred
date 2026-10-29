import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSIONS } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureSessionsPayload } from "../src/viewer_api_layer1_fixture_sessions.ts";

test("fixture sessions payload holds every session sorted by start", () => {
  const { sessions } = buildFixtureSessionsPayload();
  assert.equal(sessions.length, SESSIONS.length);
  const starts = sessions.map((session) => session.started);
  assert.deepEqual(starts, [...starts].sort());
});

test("fixture sessions carry one title per range and absolute paths", () => {
  const { sessions } = buildFixtureSessionsPayload();
  for (const session of sessions) {
    const source = SESSIONS.find((candidate) => candidate.file === session.file)!;
    assert.equal(session.titles.length, source.titles.length);
    assert.equal(session.paths.length, source.paths.length);
    for (const path of session.paths) {
      assert.ok(path.startsWith("/"), path);
    }
  }
});
