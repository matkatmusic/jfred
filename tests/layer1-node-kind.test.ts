// readNodeKind maps node classes, and labels via their dot, to show row kinds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { readNodeKind } = await import("../webapp/layer1-node-kind.ts");

test("test_readNodeKind_maps_node_classes_to_show_row_kinds", () => {
    const readKindOf = (className: string) => readNodeKind(createElement("i", { class: className }));
    assert.equal(readKindOf("node n-disk n-created"), "created");
    assert.equal(readKindOf("node n-commit"), "commit");
    assert.equal(readKindOf("node n-disk"), "disk");
    assert.equal(readKindOf("node n-snap"), "snapshot");
    assert.equal(readKindOf("node n-edit"), "edit");
    assert.equal(readKindOf("node n-read"), "edit");
    assert.equal(readKindOf("node n-script"), "script-run");
    assert.equal(readKindOf("bnode"), "branch");
    assert.equal(readNodeKind(createElement("li")), undefined);
});

test("test_readNodeKind_label_takes_previous_dot_kind", () => {
    const lane = createElement("div", {}, [createElement("i", { class: "node n-commit" }), createElement("span", { class: "nlabel" })]);
    assert.equal(readNodeKind(lane.querySelector<HTMLElement>(".nlabel")!), "commit");
    const loneLabel = createElement("div", {}, [createElement("span", { class: "nlabel" })]);
    assert.equal(readNodeKind(loneLabel.querySelector<HTMLElement>(".nlabel")!), undefined);
});
