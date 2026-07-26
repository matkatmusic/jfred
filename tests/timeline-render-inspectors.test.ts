// Tests for webapp/views/timeline-render-inspectors.ts (task 258): every timeline inspector open
// routes through openTranscriptInspectorSynced, and that wrapper must re-center the clicked row
// AFTER the Details pane is revealed — the reveal shrinks the timeline pane, so a pre-open
// centering would aim at a split that no longer exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_opening_the_inspector_recenters_the_selected_row_against_the_post_reveal_split", async () => {
    // Scenario (task 258): a row is selected and its { } button opens the transcript inspector.
    // The open reveals #inspector (shrinking the timeline), so the row is re-centered afterwards.
    // Steps:
    // boot the DOM globals the webapp module graph expects, then import the module.
    setupWebappDom();
    const { openTranscriptInspectorSynced } = await import("../webapp/views/timeline-render-inspectors.ts");
    // the Details pane starts hidden, exactly as it is before the first inspector open.
    const pane = document.getElementById("inspector")!;
    pane.classList.add("hidden");
    // a stand-in for the clicked (already-selected) row: scrollIntoView records its argument and
    // whether the pane was still hidden — i.e. whether the scroll ran before or after the reveal.
    const scrollCalls: { block: string | undefined; paneWasHidden: boolean }[] = [];
    const row = document.createElement("div");
    row.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => {
        const options = typeof arg === "object" ? arg : undefined;
        scrollCalls.push({ block: options?.block, paneWasHidden: pane.classList.contains("hidden") });
    };
    // a context whose only populated fields are the ones this path reads. The single raw line
    // belongs to no node, so the line-sync leaves the selection on the clicked row (item 43).
    const rawLines = [JSON.stringify({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } })];
    const context = { nodes: [], nodeRows: new Map(), selectedRow: row } as unknown as Parameters<typeof openTranscriptInspectorSynced>[0];
    openTranscriptInspectorSynced(context, { jsonlName: "session-a.jsonl", rawLines, line: 0 });
    // the row was centered exactly once...
    assert.equal(scrollCalls.length, 1);
    assert.equal(scrollCalls[0]!.block, "center");
    // ...and only after the Details pane had already been revealed, so the centering measured the
    // shrunken timeline rather than the full-height one.
    assert.equal(scrollCalls[0]!.paneWasHidden, false);
});

test("test_the_recenter_is_a_bare_scroll_and_never_reopens_the_selection", async () => {
    // Scenario (task 258): the details pane calls this opener while rendering, so re-selecting the
    // row here would loop. The wrapper must therefore touch nothing but scroll position.
    // Steps:
    setupWebappDom();
    const { openTranscriptInspectorSynced } = await import("../webapp/views/timeline-render-inspectors.ts");
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
