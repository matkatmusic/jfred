import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { dispatchLayer1FixtureRoute } from "../src/viewer_api_layer1_fixture.ts";
import { listFixtureEvents } from "../src/viewer_api_layer3_fixture_data.ts";
import { LAYER1_PROGRESS_LABEL_READING_EDITS } from "../src/viewer_api_layer3_fixture_replay.ts";

function dispatchGet(pathAndQuery: string): { handled: boolean; body: string } {
  let body = "";
  const append = (chunk?: string): void => {
    body += chunk ?? "";
  };
  const response = {
    writeHead: () => response,
    write: append,
    end: append,
    destroyed: false,
    socket: { destroyed: false, writable: true, setNoDelay: () => {}, uncork: () => {} },
  } as unknown as ServerResponse;
  const handled = dispatchLayer1FixtureRoute({ method: "GET" } as IncomingMessage, response, new URL(`http://localhost${pathAndQuery}`));
  return { handled, body };
}

test("the streamed edits route sends progress lines and ends with the payload", () => {
  const { handled, body } = dispatchGet("/api/layer1-edits?progress=1&dir=/ignored");
  assert.equal(handled, true);
  const lines = body.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = lines.at(-1)!;
  const progress = lines.slice(0, -1);
  assert.ok(progress.length > 0);
  assert.ok(progress.every((line) => line["kind"] === "progress" && line["label"] === LAYER1_PROGRESS_LABEL_READING_EDITS));
  assert.ok(Array.isArray(terminal["pairs"]));
  assert.equal(terminal["kind"], undefined);
});

test("the plain edits route answers one JSON payload with ISO instants and string ids", () => {
  const { body } = dispatchGet("/api/layer1-edits");
  const payload = JSON.parse(body) as { pairs: { path: string; edits: Record<string, unknown>[] }[] };
  const util = payload.pairs.find((pair) => pair.path === "src/util.ts")!;
  assert.equal(util.edits.length, 4);
  const first = util.edits[0]!;
  assert.equal(first["instant"], "2026-06-01T14:10:00.000Z");
  assert.equal(first["kind"], "read");
  assert.equal(first["sessionFile"], "/fixture/demo/projects/b21d84c5.jsonl");
  assert.equal(typeof first["changeId"], "string");
  assert.equal("axisPx" in first, false);
});

test("the file route answers an edit's bytes, title and raw record by change id", () => {
  const edit = listFixtureEvents("src/util.ts")[1]!;
  const { body } = dispatchGet(`/api/layer1-file?editChangeId=${edit.changeId}&side=target&path=src/util.ts`);
  const payload = JSON.parse(body) as { content: string; title: string; record: { toolUseResult: { structuredPatch: unknown[] } } };
  assert.ok(payload.content.includes("// edited"));
  assert.equal(payload.title, "extract the trim helper");
  assert.equal(payload.record.toolUseResult.structuredPatch.length, 1);
});

test("the file route answers the base side without the edit", () => {
  const edit = listFixtureEvents("src/util.ts")[1]!;
  const { body } = dispatchGet(`/api/layer1-file?editChangeId=${edit.changeId}&side=base&path=src/util.ts`);
  assert.ok(!(JSON.parse(body) as { content: string }).content.includes("// edited"));
});
