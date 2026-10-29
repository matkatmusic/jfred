// Task 92: inspector openers show a message in the preview pane when no transcript line resolves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_session_end_inspector_shows_a_message_when_the_session_has_no_jsonl", async () => {
    initWebappDom();
    const { openSessionEndTranscript } = await import("../webapp/views/timeline-render-inspectors.ts");
    const previewPane = document.createElement("div");
    previewPane.classList.add("hidden");
    const context = { project: "p", listing: { jsonlFiles: [] } } as unknown as Parameters<typeof openSessionEndTranscript>[0];
    const node = { sessionId: "session-a" } as unknown as Parameters<typeof openSessionEndTranscript>[1];
    await openSessionEndTranscript(context, node, previewPane);
    assert.equal(previewPane.classList.contains("hidden"), false);
    assert.equal(previewPane.textContent, "no transcript for this session");
});
