// Test for webapp/layer1-components/commits-column/layer1-jfred-api.ts: the script replay fetch functions, their request and their loading bar.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { buildNdjsonResponse } from "./webapp-fetch-test-helpers.ts";
import { fetchScriptReplayNeeds, runScriptReplay } from "../webapp/layer1-components/commits-column/layer1-jfred-api.ts";

const SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";
const NEEDS_REQUEST = { fromInstant: null, toInstant: "2026-06-03T10:30:00.000Z" };
const NEEDS_REPLY = { tasks: [] };
const RUN_REQUEST = { toInstant: "2026-06-03T10:30:00.000Z", allowScripts: true };
const RUN_REPLY = { results: [] };
let sent: { pathname: string; search: string; init: RequestInit }[] = [];

beforeEach(() => {
  initLayer1Dom(SEARCH);
});

function installRecordingRoute(reply: () => Response): void {
  sent = [];
  Object.assign(globalThis, {
    fetch: async (url: unknown, init: RequestInit): Promise<Response> => {
      const { pathname, search } = new URL(String(url), "http://localhost:7343");
      sent.push({ pathname, search, init });
      return reply();
    },
  });
}

function buildOpenStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (started) => { controller = started; } });
  const push = (line: unknown): void => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
  return { response: new Response(body), push, close: () => controller.close() };
}

test("test_needs_request_posts_the_body_to_the_needs_route", async () => {
  // Verify: one POST to the needs route with the page query, the JSON header and the request as the body; the reply comes back.
  installRecordingRoute(() => buildNdjsonResponse([NEEDS_REPLY]));
  const reply = await fetchScriptReplayNeeds(NEEDS_REQUEST);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.pathname + sent[0]!.search, `/api/layer1-script-replay-needs${SEARCH}`);
  assert.equal(sent[0]!.init.method, "POST");
  assert.deepEqual(sent[0]!.init.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), NEEDS_REQUEST);
  assert.deepEqual(reply, NEEDS_REPLY);
});

test("test_run_request_posts_the_body_to_the_run_route", async () => {
  // Verify: one POST to the run route with the page query, the JSON header and the request as the body; the reply comes back.
  installRecordingRoute(() => buildNdjsonResponse([RUN_REPLY]));
  const reply = await runScriptReplay(RUN_REQUEST);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.pathname + sent[0]!.search, `/api/layer1-script-replay-run${SEARCH}`);
  assert.equal(sent[0]!.init.method, "POST");
  assert.deepEqual(sent[0]!.init.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), RUN_REQUEST);
  assert.deepEqual(reply, RUN_REPLY);
});

test("test_progress_lines_reach_the_loading_bar", async () => {
  // Verify: the bar and the shield show the streamed label while the run is open, then both hide.
  const stream = buildOpenStream();
  installRecordingRoute(() => stream.response);
  const pending = runScriptReplay(RUN_REQUEST);
  stream.push({ kind: "progress", label: "running scripts", current: 1, total: 4 });
  await waitForAsyncWork();
  assert.equal(document.getElementById("loadbar-label")!.textContent, "running scripts — 1 / 4");
  assert.deepEqual(["loadbar", "busy-shield"].map((id) => document.getElementById(id)!.hasAttribute("hidden")), [false, false]);
  stream.push(RUN_REPLY);
  stream.close();
  assert.deepEqual(await pending, RUN_REPLY);
  assert.deepEqual(["loadbar", "busy-shield"].map((id) => document.getElementById(id)!.hasAttribute("hidden")), [true, true]);
});

test("test_error_line_throws", async () => {
  // Verify: an error line after a progress line makes the call throw the error label.
  installRecordingRoute(() => buildNdjsonResponse([{ kind: "progress", label: "checking", current: 1, total: 2 }, { kind: "error", label: "docker failed" }]));
  await assert.rejects(fetchScriptReplayNeeds(NEEDS_REQUEST), { message: "docker failed" });
});
