// Per-file test for webapp/layer1-run-stream.ts: the needs question and the run request stream, with a stubbed fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchScriptNeeds, fetchScriptRun, type RunReply } from "../webapp/layer1-run-stream.ts";
import { WireRunOutcome, type WireScriptOutputLine, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const RUN_REQUEST = { sessionFile: "/logs/s1.jsonl", toolUseId: "toolu_1", allowScripts: true };
const RESULT: WireScriptResult = {
  kind: "script-result", toolUseId: "toolu_1", outcome: WireRunOutcome.replayed, files: [], stdout: "hi\n", stderr: "", timedOut: false, isOutputSaved: true,
};
const NEED = { toolUseId: "toolu_0", sessionFile: "/logs/s1.jsonl", line: 4, instant: "2026-07-01T10:00:00.000Z", state: "unreplayed" };

type FetchCall = { url: string; init: RequestInit };

function installFetch(answer: (init: RequestInit) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  const stubbedFetch = async (url: unknown, init: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    return answer(init);
  };
  Object.assign(globalThis, { fetch: stubbedFetch });
  return calls;
}

function buildJsonReply(payload: unknown, status = 200): Response {
  const text = JSON.stringify(payload);
  return { ok: status === 200, status, json: async () => payload, text: async () => text } as unknown as Response;
}

function buildStreamReply(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

async function runWith(chunks: string[]): Promise<{ reply: RunReply; progress: string[]; output: string[]; calls: FetchCall[] }> {
  initLayer1Dom("?dir=%2Fw");
  const calls = installFetch(() => buildStreamReply(chunks));
  const progress: string[] = [];
  const output: string[] = [];
  const onProgress = (label: string, current?: number): void => { progress.push(`${label}:${current}`); };
  const onOutput = (line: WireScriptOutputLine): void => { output.push(`${line.stream}:${line.text}`); };
  const reply = await fetchScriptRun(RUN_REQUEST, onProgress, onOutput, new AbortController().signal);
  return { reply, progress, output, calls };
}

test("test_requestScriptNeeds_posts_json_with_the_page_query_and_reads_an_empty_list", async () => {
  // Verify: the url and headers are right; an empty list and a two-entry list come back whole.
  initLayer1Dom("?dir=%2Fw");
  const calls = installFetch(() => buildJsonReply({ toolUseId: "toolu_1", needs: [] }));
  const reply = await fetchScriptNeeds({ sessionFile: "/logs/s1.jsonl", toolUseId: "toolu_1" }, new AbortController().signal);
  assert.deepEqual(reply, { toolUseId: "toolu_1", needs: [] });
  assert.equal(calls[0]!.url, "/api/layer1-script-needs?dir=%2Fw");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json" });
  const needs = [NEED, { ...NEED, toolUseId: "toolu_00", state: "replay-failed" }];
  installFetch(() => buildJsonReply({ toolUseId: "toolu_1", needs }));
  const twoEntryReply = await fetchScriptNeeds({ sessionFile: "f", toolUseId: "t" }, new AbortController().signal);
  assert.deepEqual(twoEntryReply.needs, needs);
});

test("test_requestScriptNeeds_throws_on_a_400_and_on_a_wrong_shape", async () => {
  // Verify: a bad status and a reply that is not a needs reply both throw.
  initLayer1Dom();
  const signal = new AbortController().signal;
  installFetch(() => buildJsonReply("bad host", 400));
  await assert.rejects(fetchScriptNeeds({ sessionFile: "f", toolUseId: "t" }, signal), /bad host/);
  installFetch(() => buildJsonReply({ toolUseId: "toolu_1", needs: [{ ...NEED, state: "weird" }] }));
  await assert.rejects(fetchScriptNeeds({ sessionFile: "f", toolUseId: "t" }, signal), /not a needed run/);
  installFetch(() => buildJsonReply({ nope: true }));
  await assert.rejects(fetchScriptNeeds({ sessionFile: "f", toolUseId: "t" }, signal), /not a script-needs reply/);
});

test("test_requestScriptNeeds_rejects_with_the_abort_reason", async () => {
  // Verify: an abort before the reply rejects with the reason the caller gave.
  initLayer1Dom();
  const controller = new AbortController();
  const stubbedFetch = (_url: unknown, init: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
  });
  Object.assign(globalThis, { fetch: stubbedFetch });
  const pending = fetchScriptNeeds({ sessionFile: "f", toolUseId: "t" }, controller.signal);
  controller.abort(new Error("stop now"));
  await assert.rejects(pending, /stop now/);
});

test("test_requestScriptRun_reads_lines_split_across_chunks_in_order", async () => {
  // Verify: a cut line still parses, order holds, and the request is a JSON POST with the page query.
  const lines = [
    JSON.stringify({ kind: "progress", label: "starting", current: 1, total: 2 }),
    JSON.stringify({ kind: "script-output", stream: "stdout", text: "hi\n" }),
    JSON.stringify({ kind: "script-output", stream: "stderr", text: "oops\n" }),
    JSON.stringify(RESULT),
  ].join("\n") + "\n";
  const cut = Math.floor(lines.length / 3);
  const { reply, progress, output, calls } = await runWith([lines.slice(0, cut), lines.slice(cut, cut * 2), lines.slice(cut * 2)]);
  assert.equal(calls[0]!.url, "/api/layer1-script-run?dir=%2Fw");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(calls[0]!.init.headers, { "Content-Type": "application/json" });
  assert.equal(calls[0]!.init.body, JSON.stringify(RUN_REQUEST));
  assert.deepEqual(reply, { kind: "result", result: RESULT });
  assert.deepEqual(progress, ["starting:1"]);
  assert.deepEqual(output, ["stdout:hi\n", "stderr:oops\n"]);
});

test("test_requestScriptRun_throws_on_an_error_line", async () => {
  // Verify: an error line throws its label; a stream with no result throws too.
  await assert.rejects(runWith([JSON.stringify({ kind: "error", label: "earlier run not saved" }) + "\n"]), /earlier run not saved/);
  await assert.rejects(runWith([JSON.stringify({ kind: "progress", label: "x" }) + "\n"]), /ended before the result/);
});

test("test_requestScriptRun_throws_on_an_unknown_line_kind", async () => {
  // Verify: a line with an unknown kind throws an error naming the line.
  await assert.rejects(runWith([JSON.stringify({ kind: "mystery", note: "x" }) + "\n"]), /unknown script run stream line.*mystery/);
});

test("test_requestScriptRun_returns_consent_required_for_the_single_json_reply", async () => {
  // Verify: the consent reply has no trailing newline and still reads as one line.
  const { reply } = await runWith([JSON.stringify({ kind: "consent-required", scripts: [] })]);
  assert.deepEqual(reply, { kind: "consent-required" });
});

test("test_requestScriptRun_returns_cancelled_when_the_signal_aborts_mid_stream", async () => {
  // Verify: an abort returns cancelled and does not throw.
  initLayer1Dom();
  const controller = new AbortController();
  const stubbedFetch = async (_url: unknown, init: RequestInit): Promise<Response> => {
    const body = new ReadableStream({
      start(streamController) {
        init.signal!.addEventListener("abort", () => streamController.error(init.signal!.reason));
      },
    });
    return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
  };
  Object.assign(globalThis, { fetch: stubbedFetch });
  const pending = fetchScriptRun(RUN_REQUEST, () => undefined, () => undefined, controller.signal);
  controller.abort();
  assert.deepEqual(await pending, { kind: "cancelled" });
});
