import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInverseReposUrl, readInverseReposStream } from "../webapp/layer1-components/bars-view/layer1-bars-stream.ts";
import type { InverseProgressLine, InverseReposWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { buildNdjsonResponse } from "./webapp-fetch-test-helpers.ts";

const RESULT_LINE: InverseReposWire = { files: [{ file: "a.ts", commits: [] }] };

function stubFetch(buildResponse: () => Response): void {
    Object.assign(globalThis, { fetch: async () => buildResponse() });
}

function buildStreamResponse(chunkTexts: string[], isClosed: boolean): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            for (const chunkText of chunkTexts) {
                controller.enqueue(encoder.encode(chunkText));
            }
            if (isClosed) {
                controller.close();
            }
        },
    });
    return new Response(body);
}

test("test_the_url_keeps_dir_every_jsonl_and_every_snapshots_and_adds_progress", () => {
    // Params hold one dir, two jsonl and two snapshots.
    const sourceParams = new URLSearchParams("dir=/proj&jsonl=/logs/a&jsonl=/logs/b&snapshots=/snap/1&snapshots=/snap/2");
    // The built url keeps all of them and adds progress=1.
    const url = new URL(buildInverseReposUrl(sourceParams), "http://localhost");
    assert.equal(url.pathname, "/api/layer1-inverse-repos");
    assert.deepEqual(url.searchParams.getAll("dir"), ["/proj"]);
    assert.deepEqual(url.searchParams.getAll("jsonl"), ["/logs/a", "/logs/b"]);
    assert.deepEqual(url.searchParams.getAll("snapshots"), ["/snap/1", "/snap/2"]);
    assert.deepEqual(url.searchParams.getAll("progress"), ["1"]);
});

test("test_the_url_drops_repo_ref_and_time", () => {
    // Params hold dir plus the keys that must be dropped.
    const sourceParams = new URLSearchParams("dir=/proj&repo=/r&ref=main&time=2026-01-01&other=x");
    // The built url keeps only dir and progress.
    const url = new URL(buildInverseReposUrl(sourceParams), "http://localhost");
    assert.deepEqual([...url.searchParams.keys()], ["dir", "progress"]);
});

test("test_every_progress_line_reaches_the_callback_in_order_then_the_result_returns", async () => {
    // The server sends two progress lines then the result line.
    const firstLine: InverseProgressLine = { kind: "progress", label: "building inverse repos", current: 0, total: 1, steps: [] };
    const secondLine: InverseProgressLine = { kind: "progress", label: "step", file: "a.ts", fileStepsDone: 1, fileStepsTotal: 2 };
    stubFetch(() => buildNdjsonResponse([firstLine, secondLine, RESULT_LINE]));
    // The reader hands each progress line to the callback.
    const seenLines: InverseProgressLine[] = [];
    const result = await readInverseReposStream("/x", (line) => seenLines.push(line), new AbortController().signal);
    // The callback saw both lines in order and the result came back.
    assert.deepEqual(seenLines, [firstLine, secondLine]);
    assert.deepEqual(result, RESULT_LINE);
});

test("test_a_line_split_over_two_chunks_is_read_whole", async () => {
    // One progress line and the result line are cut in the middle of a line.
    const progressLine: InverseProgressLine = { kind: "progress", label: "split label", current: 0, total: 1 };
    const progressText = JSON.stringify(progressLine) + "\n";
    const resultText = JSON.stringify(RESULT_LINE) + "\n";
    const cutPoint = 10;
    stubFetch(() => buildStreamResponse([progressText.slice(0, cutPoint), progressText.slice(cutPoint) + resultText.slice(0, 5), resultText.slice(5)], true));
    // The reader joins the pieces.
    const seenLines: InverseProgressLine[] = [];
    const result = await readInverseReposStream("/x", (line) => seenLines.push(line), new AbortController().signal);
    assert.deepEqual(seenLines, [progressLine]);
    assert.deepEqual(result, RESULT_LINE);
});

test("test_an_error_line_throws_its_label", async () => {
    // The server sends an error line.
    stubFetch(() => buildNdjsonResponse([{ kind: "error", label: "inverse repos failed" }]));
    // The reader throws the label.
    await assert.rejects(readInverseReposStream("/x", () => {}, new AbortController().signal), { message: "inverse repos failed" });
});

test("test_a_stream_with_no_result_line_throws", async () => {
    // The stream ends after one progress line.
    stubFetch(() => buildNdjsonResponse([{ kind: "progress", label: "only progress", current: 0, total: 1 }]));
    // The reader throws.
    await assert.rejects(readInverseReposStream("/x", () => {}, new AbortController().signal), /no result/);
});

test("test_a_non_ok_response_throws_the_response_text", async () => {
    // The server answers 500 with a text body.
    stubFetch(() => new Response("server broke", { status: 500 }));
    // The reader throws that text.
    await assert.rejects(readInverseReposStream("/x", () => {}, new AbortController().signal), { message: "server broke" });
});

test("test_an_aborted_stream_returns_undefined", async () => {
    // The stream sends one progress line and then stays open.
    const progressLine: InverseProgressLine = { kind: "progress", label: "open", current: 0, total: 1 };
    stubFetch(() => buildStreamResponse([JSON.stringify(progressLine) + "\n"], false));
    // The page aborts when it sees that line.
    const controller = new AbortController();
    const result = await readInverseReposStream("/x", () => controller.abort(), controller.signal);
    // The reader returns undefined.
    assert.equal(result, undefined);
});
