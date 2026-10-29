// DOM tests for the node builders in webapp/views/conversation-nodes.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

async function importNodes(): Promise<typeof import("../webapp/views/conversation-nodes.ts")> {
    initWebappDom();
    return import("../webapp/views/conversation-nodes.ts");
}

test("test_renderBranchStrip_labels_surviving_and_rewound_chips", async () => {
    // Scenario: a surviving branch and a rewound branch get distinct chip classes and short tips.
    const nodes = await importNodes();
    const strip = nodes.renderBranchStrip([{ isSurviving: true, tip: "1234567890" }, { isSurviving: false, tip: "abcdefghij" }]);
    // assert one chip per branch with its class and eight-character tip.
    const chips = strip.querySelectorAll(".branch-chip");
    assert.equal(chips[0]!.className, "branch-chip surviving");
    assert.equal(chips[0]!.textContent, "surviving · tip 12345678");
    assert.equal(chips[1]!.className, "branch-chip rewound");
    assert.equal(chips[1]!.textContent, "rewound · tip abcdefgh");
});

test("test_buildMessageBubbleNode_click_inspects_its_line", async () => {
    // Scenario: clicking a bubble calls the inspector callback with the bubble's line.
    const nodes = await importNodes();
    const inspectedLines: number[] = [];
    const bubble = nodes.buildMessageBubbleNode({ uuid: "u", role: "user", text: "yo" }, 7, (line) => inspectedLines.push(line));
    bubble.click();
    // assert the callback saw line 7 and the bubble shows its text.
    assert.deepEqual(inspectedLines, [7]);
    assert.ok(bubble.textContent!.includes("yo"));
});

test("test_buildStubRowNode_click_inspects_its_line", async () => {
    // Scenario: clicking a stub row calls the inspector callback with the stub's line.
    const nodes = await importNodes();
    const inspectedLines: number[] = [];
    const stub = nodes.buildStubRowNode({ kind: "stub", line: 3, uuid: "s", type: "system", verdict: "folded" }, (line) => inspectedLines.push(line));
    stub.click();
    // assert the callback saw line 3 and the stub prints line, type, and verdict.
    assert.deepEqual(inspectedLines, [3]);
    assert.equal(stub.textContent, "line 3 · system · folded");
});

test("test_appendEditMarkerLink_links_to_the_file_history_route", async () => {
    // Scenario: an edit marker shows the file name and links to the file-history route.
    const nodes = await importNodes();
    const column = nodes.createConversationColumn();
    nodes.appendEditMarkerLink(column, "proj", "/src/x.ts");
    // assert the marker text and href.
    const marker = column.querySelector(".edit-marker")!;
    assert.equal(marker.textContent, "✎ x.ts");
    assert.equal(marker.getAttribute("href"), "#/project/proj/file/%2Fsrc%2Fx.ts");
});
