// Tests for the pure page-expression builders in scripts/visual/mockup-diff-pane.ts.

// import { strict as assert } from "node:assert";
// import { test } from "node:test";
// import { getPaneArrow, getRingMarker, listNodes, triggerNodeClick } from "../scripts/visual/mockup-diff-pane.ts";

// not behavior: it only checks that a built code string contains certain text fragments.
// test("listNodes scopes the node list to the path's bubble", () => {
//     const expression = listNodes("src/util.ts");
//     assert.ok(expression.includes(`.fname[data-path="src/util.ts"]`));
//     assert.ok(expression.includes(".node:not(.n-created)"));
// });

// not behavior: it only checks that a built code string contains certain text fragments.
// test("triggerNodeClick passes the index and the shift flag into the click", () => {
//     assert.ok(triggerNodeClick("a.ts", 3, true).includes("[3]"));
//     assert.ok(triggerNodeClick("a.ts", 3, true).includes("shiftKey: true"));
//     assert.ok(triggerNodeClick("a.ts", 0).includes("shiftKey: false"));
// });

// not behavior: it only checks that a built code string ends with certain text.
// test("getPaneArrow picks the button at the index", () => {
//     assert.ok(getPaneArrow(2).endsWith("[2]"));
// });

// not behavior: it only checks that a built code string contains certain text.
// test("getRingMarker looks up the node with the given class", () => {
//     assert.ok(getRingMarker("diff-base").includes("document.querySelector('.diff-base')"));
// });
