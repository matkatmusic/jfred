// Task 360: the show row's boxes hide node kinds by a `.viz-root` attribute and save per project.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getInputById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { VIEW, readHiddenKinds, toggleBox } from "./layer1-kind-filter-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1Stage } = await import("../webapp/layer1-stage-render.ts");
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { classifyNodeKind } = await import("../webapp/layer1-node-kind.ts");

async function renderFreshView(dir: string = ""): Promise<void> {
    initLayer1Dom();
    getInputById("dir").value = dir;
    await renderLayer1View(VIEW);
}

test("test_classifyNodeKind_maps_node_classes_to_show_row_kinds", () => {
    initLayer1Dom();
    const classify = (className: string) => classifyNodeKind(createElement("i", { class: className }));
    assert.equal(classify("node n-disk n-created"), "created");
    assert.equal(classify("node n-commit"), "commit");
    assert.equal(classify("node n-disk"), "disk");
    assert.equal(classify("node n-snap"), "snapshot");
    assert.equal(classify("node n-edit conf-verified"), "edit");
    assert.equal(classify("node n-read conf-verified"), "edit");
    assert.equal(classify("node n-script"), "script-run");
    assert.equal(classify("bnode"), "branch");
    assert.equal(classifyNodeKind(createElement("li")), undefined);
    const lane = createElement("div", {}, [createElement("i", { class: "node n-commit" }), createElement("span", { class: "nlabel" })]);
    assert.equal(classifyNodeKind(lane.querySelector<HTMLElement>(".nlabel")!), "commit");
});

test("test_unchecking_a_box_sets_the_hidden_kinds_attribute_on_viz_root", async () => {
    await renderFreshView();
    assert.equal(readHiddenKinds(), "edit script-run branch");
    toggleBox("snapshot", false);
    assert.equal(readHiddenKinds(), "edit script-run branch snapshot");
});

test("test_unchecking_every_box_hides_every_kind", async () => {
    await renderFreshView();
    for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input")) {
        toggleBox(box.dataset["kind"]!, false);
    }
    assert.equal(readHiddenKinds(), "edit script-run branch commit disk snapshot");
});

test("test_rechecking_a_box_removes_its_kind_from_the_attribute", async () => {
    await renderFreshView();
    toggleBox("snapshot", false);
    toggleBox("commit", false);
    toggleBox("snapshot", true);
    assert.equal(readHiddenKinds(), "edit script-run branch commit");
});

test("test_the_attribute_survives_a_stage_redraw", async () => {
    await renderFreshView();
    toggleBox("snapshot", false);
    const staleStageBubble = document.querySelector("#stage .filebox");
    await renderLayer1Stage(VIEW);
    assert.equal(readHiddenKinds(), "edit script-run branch snapshot");
    assert.notEqual(document.querySelector("#stage .filebox"), staleStageBubble);
});

test("test_hiding_a_kind_never_redraws_the_stage", async () => {
    await renderFreshView();
    const bubble = document.querySelector("#stage .filebox");
    const axisPx = (bubble as HTMLElement).style.getPropertyValue("--axis-px");
    toggleBox("snapshot", false);
    assert.equal(document.querySelector("#stage .filebox"), bubble);
    assert.equal((bubble as HTMLElement).style.getPropertyValue("--axis-px"), axisPx);
});
