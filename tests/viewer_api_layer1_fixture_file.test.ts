import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { sendFixtureDiff, sendFixtureFile, sendFixtureRecord } from "../src/viewer_api_layer1_fixture_file.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { SNAPSHOTS } from "../src/viewer_api_layer2_fixture_data.ts";
import { SCRIPT_RUNS } from "../src/viewer_api_layer4_fixture_data.ts";

function makeFakeResponse(): { response: ServerResponse; body: () => string } {
  let written = "";
  const response = {
    writeHead: () => response,
    end: (chunk: string | Buffer) => { written = String(chunk); },
  } as unknown as ServerResponse;
  return { response, body: () => written };
}

test("a snapshot request answers content and the title in effect at its line", () => {
  const { response, body } = makeFakeResponse();
  const query = new URLSearchParams({
    path: "src/util.ts", snapshotSession: "/x/b21d84c5.jsonl", version: "1" });
  sendFixtureFile(response, query);
  const payload = JSON.parse(body()) as { content: string; title: string };
  assert.ok(payload.content.includes("@v1"));
  assert.equal(payload.title, "extract the trim helper");
});

test("a scriptRun request answers the canned script body", () => {
  const { response, body } = makeFakeResponse();
  const run = SCRIPT_RUNS[0]!;
  sendFixtureFile(response, new URLSearchParams({ path: "src/index.ts", scriptRun: run.toolUseId }));
  assert.equal((JSON.parse(body()) as { content: string }).content, run.code.join("\n"));
});

function readFixtureRecordAt(session: string, line: number): { type: string; sessionId: string } {
  const { response, body } = makeFakeResponse();
  sendFixtureRecord(response, new URLSearchParams({ jsonl: `/fixture/demo/projects/${session}`, line: String(line) }));
  return JSON.parse(body()) as { type: string; sessionId: string };
}

test("test_every_snapshot_line_answers_a_record", () => {
  // Steps: ask for the record at each snapshot's session and line; none may throw.
  for (const snapshot of SNAPSHOTS) {
    assert.equal(readFixtureRecordAt(snapshot.session, snapshot.line).type, "file-history-snapshot");
  }
});

test("test_every_script_run_line_answers_a_record", () => {
  // Steps: ask for the record at each script run's session and line; none may throw.
  for (const run of SCRIPT_RUNS) {
    assert.equal(readFixtureRecordAt(run.session, run.line).type, "assistant");
  }
});

test("test_an_annotation_line_answers_its_label_as_a_record", () => {
  // Steps: take the first annotation, ask for its session file and line, and compare the fields.
  const annotation = buildFixtureLayer1View().annotations![0]!;
  const { response, body } = makeFakeResponse();
  sendFixtureRecord(response, new URLSearchParams({ jsonl: annotation.sessionFile, line: String(annotation.line) }));
  assert.deepEqual(JSON.parse(body()), {
    type: annotation.kind, uuid: annotation.id.toString(), timestamp: annotation.instant.toISOString(),
    sessionId: annotation.sessionId.toString(), message: { content: annotation.label },
  });
});

test("test_an_unknown_line_throws", () => {
  // Steps: ask for a line that no fixture entry owns.
  assert.throws(() => readFixtureRecordAt("0f3c9a7e.jsonl", 999999), /no fixture record/);
});

test("a diff between two working trees is an empty-change payload", () => {
  const { response, body } = makeFakeResponse();
  sendFixtureDiff(response, new URLSearchParams({ path: "src/index.ts" }));
  assert.ok("diff" in (JSON.parse(body()) as object));
});
