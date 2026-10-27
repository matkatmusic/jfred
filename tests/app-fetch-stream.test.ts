// DOM tests for webapp/app-fetch-stream.ts: megabyte labels and the NDJSON document stream reader.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

// The progress bar's elapsed-clock interval keeps node alive until it is hidden.
async function stopProgressClock(): Promise<void> {
  const { hideLoadingProgress } = await import("../webapp/app-progress.ts");
  hideLoadingProgress();
}

function createNdjsonResponse(lines: unknown[]): Response {
  const serializedLines: string[] = [];
  for (const line of lines) {
    serializedLines.push(JSON.stringify(line));
  }
  const encoded = new TextEncoder().encode(serializedLines.join("\n") + "\n");
  const body = new ReadableStream({ start: (controller) => {
    controller.enqueue(encoded);
    controller.close();
  } });
  return { body } as unknown as Response;
}

test("test_formatMegabytes_rounds_to_one_decimal", async () => {
  initWebappDom();
  const { formatMegabytes } = await import("../webapp/app-fetch-stream.ts");
  assert.equal(formatMegabytes(67_400_000), "67.4 MB");
});

test("test_readDocumentStream_returns_the_last_non_progress_line", async () => {
  initWebappDom();
  const { readDocumentStream } = await import("../webapp/app-fetch-stream.ts");
  const response = createNdjsonResponse([
    { kind: "progress", label: "loading", current: 1, total: 2 },
    { kind: "progress", label: "loading" },
    { messages: [] },
  ]);
  const payload = await readDocumentStream(response);
  await stopProgressClock();
  assert.deepEqual(payload, { messages: [] });
});

test("test_readDocumentStream_returns_a_consent_decision_line", async () => {
  initWebappDom();
  const { readDocumentStream } = await import("../webapp/app-fetch-stream.ts");
  const response = createNdjsonResponse([
    { kind: "progress", label: "loading" },
    { kind: "consent-required", scripts: [] },
  ]);
  const payload = await readDocumentStream(response);
  await stopProgressClock();
  assert.equal(payload.kind, "consent-required");
});
