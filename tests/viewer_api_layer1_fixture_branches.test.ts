// Task 357 step 5: fixture mode serves the canned lanes on /api/layer1-branches in the real wire shape; the base view carries none.

import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES } from "../src/layer1_branches_wire.ts";
import { dispatchLayer1FixtureRoute } from "../src/viewer_api_layer1_fixture.ts";
import { COMMITS, parseMs } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";

type LaneRow = { rewindKind: string; forkAt: string; rejoinAt?: string; nodes: Record<string, unknown>[] };
type BranchesPayload = { pairs: { path: string; branches: LaneRow[] }[] };

function dispatchGet(pathAndQuery: string): { handled: boolean; body: string } {
  let body = "";
  const append = (chunk?: string): void => {
    body += chunk ?? "";
  };
  const response = {
    writeHead: () => response, write: append, end: append, destroyed: false,
    socket: { destroyed: false, writable: true, setNoDelay: () => {}, uncork: () => {} },
  } as unknown as ServerResponse;
  const handled = dispatchLayer1FixtureRoute({ method: "GET" } as IncomingMessage, response, new URL(`http://localhost${pathAndQuery}`));
  return { handled, body };
}

function readPayload(): BranchesPayload {
  return JSON.parse(dispatchGet("/api/layer1-branches").body) as BranchesPayload;
}

test("the streamed branches route sends both stage labels, then the payload", () => {
  const { handled, body } = dispatchGet("/api/layer1-branches?progress=1&dir=/ignored");
  assert.equal(handled, true);
  const lines = body.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(lines.slice(0, -1), [
    { kind: "progress", label: LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, current: 1, total: 1 },
    { kind: "progress", label: LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, current: 1, total: 1 },
  ]);
  assert.ok(Array.isArray(lines.at(-1)!["pairs"]));
});

test("the canned lanes keep their kinds, rejoin on trunk commits and carry change ids without axisPx", () => {
  const { pairs } = readPayload();
  assert.deepEqual(pairs.map((pair) => pair.path).sort(), ["src/index.ts", "src/util.ts"]);
  const index = pairs.find((pair) => pair.path === "src/index.ts")!;
  assert.deepEqual(index.branches.map((lane) => [lane.rewindKind, lane.rejoinAt]), [["conversation", "2026-06-03T18:20:00.000Z"], ["code", undefined]]);
  for (const node of pairs.flatMap((pair) => pair.branches.flatMap((lane) => lane.nodes))) {
    assert.equal(typeof node["changeId"], "string");
    assert.equal("axisPx" in node, false);
  }
});

test("every fork instant sits one minute after the commit it used to share", () => {
  const forkInstants = readPayload().pairs.flatMap((pair) => pair.branches.map((lane) => lane.forkAt)).sort();
  assert.deepEqual(forkInstants, ["2026-06-01T14:31:00.000Z", "2026-06-01T14:31:00.000Z", "2026-06-03T18:21:00.000Z"]);
  const commitMs = new Set(COMMITS.map((commit) => parseMs(commit.at)));
  assert.ok(forkInstants.every((instant) => !commitMs.has(Date.parse(instant))));
});

test("a canned lane node's branch file read answers a before and a different non-empty after", () => {
  const readSide = (side: string): string => (JSON.parse(dispatchGet(`/api/layer1-file?editChangeId=toolu_fixture_branch_0_0_0&side=${side}&path=src/util.ts&branch=1`).body) as { content: string }).content;
  assert.notEqual(readSide("base"), "");
  assert.notEqual(readSide("target"), readSide("base"));
});

test("the base fixture view carries no branches key", () => {
  assert.ok(buildFixtureLayer1View().pairs.every((pair) => !("branches" in pair)));
});
