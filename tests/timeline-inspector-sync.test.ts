// Task 258: the inspector open re-centers the clicked row after the Details pane is revealed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_opening_the_inspector_recenters_the_selected_row_against_the_post_reveal_split", async () => {
    // Task 258: opening the inspector reveals the pane, then the selected row re-centers.
    initWebappDom();
    const { openTranscriptInspectorSynced } = await import("../webapp/views/timeline-inspector-sync.ts");
    // the Details pane starts hidden, exactly as it is before the first inspector open.
    const pane = document.getElementById("inspector")!;
    pane.classList.add("hidden");
    // Stand-in row: scrollIntoView records its argument and whether the pane was still hidden.
    const scrollCalls: { block: string | undefined; paneWasHidden: boolean }[] = [];
    const row = document.createElement("div");
    row.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => {
        const options = typeof arg === "object" ? arg : undefined;
        scrollCalls.push({ block: options?.block, paneWasHidden: pane.classList.contains("hidden") });
    };
    // The raw line belongs to no node, so line-sync keeps the selection on the clicked row.
    const rawLines = [JSON.stringify({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } })];
    const context = { nodes: [], nodeRows: new Map(), selectedRow: row } as unknown as Parameters<typeof openTranscriptInspectorSynced>[0];
    openTranscriptInspectorSynced(context, { jsonlName: "session-a.jsonl", rawLines, line: 0 });
    // the row was centered exactly once...
    assert.equal(scrollCalls.length, 1);
    assert.equal(scrollCalls[0]!.block, "center");
    // ...and only after the Details pane was revealed, so it measured the shrunken timeline.
    assert.equal(scrollCalls[0]!.paneWasHidden, false);
});

test("test_the_recenter_is_a_bare_scroll_and_never_reopens_the_selection", async () => {
    // Task 258: the details pane calls this opener while rendering, so it must only scroll.
    initWebappDom();
    const { openTranscriptInspectorSynced } = await import("../webapp/views/timeline-inspector-sync.ts");
    const row = document.createElement("div");
    row.classList.add("selected");
    row.scrollIntoView = () => {};
    // selectTimelineRow is the loop hazard: if the wrapper called it, this spy would fire.
    let selectCalls = 0;
    const rawLines = [JSON.stringify({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } })];
    const context = {
        nodes: [], nodeRows: new Map(), selectedRow: row,
        selectTimelineRow: async () => { selectCalls += 1; },
    } as unknown as Parameters<typeof openTranscriptInspectorSynced>[0];
    openTranscriptInspectorSynced(context, { jsonlName: "session-a.jsonl", rawLines, line: 0 });
    // no re-selection, and the selection itself is untouched.
    assert.equal(selectCalls, 0);
    assert.equal(context.selectedRow, row);
    assert.ok(row.classList.contains("selected"));
});
