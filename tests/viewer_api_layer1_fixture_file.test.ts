import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { sendFixtureDiff, sendFixtureFile } from "../src/viewer_api_layer1_fixture_file.ts";

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

test("a diff between two working trees is an empty-change payload", () => {
  const { response, body } = makeFakeResponse();
  sendFixtureDiff(response, new URLSearchParams({ path: "src/index.ts" }));
  assert.ok("diff" in (JSON.parse(body()) as object));
});
