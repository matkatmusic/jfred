import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertEventsPlaced, assertFixtureOrder, assertScriptRunsInSessions,
} from "../src/viewer_api_fixture_check.ts";
import type { BulkFixtureTarget } from "../src/viewer_api_fixture_bulk.ts";
import { COMMITS, DISK, SESSIONS } from "../src/viewer_api_layer1_fixture_data.ts";
import { EDITS, type FixtureEvent } from "../src/viewer_api_layer3_fixture_data.ts";
import { SCRIPT_RUNS } from "../src/viewer_api_layer4_fixture_data.ts";
import "../src/viewer_api_layer2_fixture_data.ts";

const CRAFTED_READ = EDITS[0]!;
const CRAFTED_EDIT = EDITS[1]!;

function buildTarget(overrides: Partial<BulkFixtureTarget>): BulkFixtureTarget {
  return { commits: COMMITS, disk: DISK, sessions: SESSIONS, snapshots: [], edits: [], scriptRuns: [], ...overrides };
}

function assertEventThrows(event: FixtureEvent, message: RegExp): void {
  assert.throws(() => assertEventsPlaced(buildTarget({ edits: [event] })), message);
}

test("the real crafted and bulk events pass the placement check", () => {
  assert.doesNotThrow(() => assertEventsPlaced(buildTarget({ edits: EDITS })));
});

test("an event before its file was born throws", () => {
  assertEventThrows({ ...CRAFTED_READ, at: "2026-06-01T08:00:00Z" }, /before born/);
});

test("an event after its file's mtime throws", () => {
  assertEventThrows({ ...CRAFTED_READ, session: "d4a06b8f.jsonl", at: "2026-07-24T09:00:00Z" }, /after mtime/);
});

test("an event outside its session's window throws", () => {
  assertEventThrows({ ...CRAFTED_READ, session: "b21d84c5.jsonl", at: "2026-06-01T08:50:00Z" }, /outside its session's window/);
});

test("an event off every title line throws", () => {
  assertEventThrows({ ...CRAFTED_READ, line: 999 }, /in no title range/);
});

test("an edit whose hunk counts disagree with its rows throws", () => {
  const hunk = CRAFTED_EDIT.hunks![0]!;
  assertEventThrows({ ...CRAFTED_EDIT, hunks: [{ ...hunk, oldLines: hunk.oldLines + 1 }] }, /hunk counts/);
});

test("an edit with an unprefixed row or a zero start throws", () => {
  const hunk = CRAFTED_EDIT.hunks![0]!;
  assertEventThrows({ ...CRAFTED_EDIT, hunks: [{ ...hunk, lines: ["no prefix", ...hunk.lines.slice(1)] }] }, /no \+ - or space prefix/);
  assertEventThrows({ ...CRAFTED_EDIT, hunks: [{ ...hunk, oldStart: 0 }] }, /hunk starts at line 0/);
});

test("a write with no content throws", () => {
  assertEventThrows({ ...CRAFTED_READ, kind: "write", content: [] }, /a write has no content/);
});

test("an event whose declared confidence differs from the replay throws", () => {
  const wrongDeclaration = { ...CRAFTED_READ, changeId: "toolu_wrong_declaration", expectDerived: true as const };
  EDITS.push(wrongDeclaration);
  try {
    assertEventThrows(wrongDeclaration, /replay says verified, the fixture declares derived/);
  }
  finally {
    EDITS.splice(EDITS.indexOf(wrongDeclaration), 1);
  }
});

test("a snapshot after its file's mtime throws", () => {
  const snapshots = [{ path: "README.md", version: "@v1", at: "2026-07-21T00:00:00Z", session: "7ce50a19.jsonl", line: 1 }];
  assert.throws(() => assertFixtureOrder(buildTarget({ snapshots })), /after mtime/);
});

test("a script run outside its session's window throws", () => {
  const run = { ...SCRIPT_RUNS[0]!, at: "2026-01-01T00:00:00Z" };
  assert.throws(() => assertScriptRunsInSessions(buildTarget({ scriptRuns: [run] })), /outside session 0f3c9a7e.jsonl/);
});

test("the canned script runs sit inside their sessions", () => {
  assert.doesNotThrow(() => assertScriptRunsInSessions(buildTarget({ scriptRuns: SCRIPT_RUNS })));
});
