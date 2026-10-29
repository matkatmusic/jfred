// DOM tests for webapp/layer1-kind-buttons.ts: the [3] and [4] buttons tick the Edit and script run boxes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

async function importKindButtonsWithBoxes(editChecked: boolean, scriptRunChecked: boolean): Promise<typeof import("../webapp/layer1-kind-buttons.ts")> {
    initWebappDom();
    const editState = editChecked ? "checked" : "";
    const scriptRunState = scriptRunChecked ? "checked" : "";
    document.body.innerHTML = `
        <button id="layer-3"></button>
        <button id="layer-4"></button>
        <div id="show-row">
            <input type="checkbox" data-kind="edit" ${editState}>
            <input type="checkbox" data-kind="script-run" ${scriptRunState}>
        </div>`;
    return import("../webapp/layer1-kind-buttons.ts");
}

function findBox(kind: string): HTMLInputElement {
    return document.querySelector<HTMLInputElement>(`#show-row input[data-kind="${kind}"]`)!;
}

test("test_layer_3_button_ticks_the_edit_box", async () => {
    const { attachKindButtons } = await importKindButtonsWithBoxes(false, false);
    attachKindButtons();
    document.getElementById("layer-3")!.click();
    assert.equal(findBox("edit").checked, true);
    assert.equal(findBox("script-run").checked, false);
});

test("test_layer_3_button_keeps_an_already_ticked_edit_box_ticked", async () => {
    const { attachKindButtons } = await importKindButtonsWithBoxes(true, false);
    attachKindButtons();
    document.getElementById("layer-3")!.click();
    assert.equal(findBox("edit").checked, true);
});

test("test_layer_4_button_leaves_two_ticked_boxes_ticked", async () => {
    const { markEditAndScriptRunBoxesChecked } = await importKindButtonsWithBoxes(true, true);
    await markEditAndScriptRunBoxesChecked();
    assert.equal(findBox("edit").checked, true);
    assert.equal(findBox("script-run").checked, true);
});
