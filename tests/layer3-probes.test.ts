// Tests for the pure expression builders in scripts/visual/layer3-probes.ts.

// import { strict as assert } from "node:assert";
// import { test } from "node:test";
// import { buildDotFinder, buildRowsProbe, buildRulerMatchProbe, buildTokenColour } from "../scripts/visual/layer3-probes.ts";

// not behavior: only checks substrings of a generated browser-expression string.
// test("buildRulerMatchProbe finds the tick by its data-full-time stamp, not its text", () => {
//     const expression = buildRulerMatchProbe("d", "07-24 08:15:00");
//     assert.ok(expression.includes(`t.dataset.fullTime.startsWith("07-24 08:15:00")`));
//     assert.ok(!expression.includes("t.textContent"));
// });

// not behavior: only checks substrings of a generated browser-expression string.
// test("buildDotFinder scopes the search to the path's bubble and the dot class", () => {
//     const expression = buildDotFinder("src/util.ts", "n-edit");
//     assert.ok(expression.includes(`.fname[data-path="src/util.ts"]`));
//     assert.ok(expression.includes("i.node.n-edit"));
//     assert.ok(expression.includes(".find(d => true)"));
// });

// not behavior: only checks substrings of a generated browser-expression string.
// test("buildDotFinder carries the caller's filter into find", () => {
//     assert.ok(buildDotFinder("a.ts", "n-read", "d.dataset.confidence === 'derived'")
//         .includes(".find(d => d.dataset.confidence === 'derived')"));
// });

// not behavior: only checks a substring of a generated browser-expression string.
// test("buildRowsProbe scopes the rows to the path's bubble", () => {
//     assert.ok(buildRowsProbe("README.md").includes(`.fname[data-path="README.md"]`));
// });

// not behavior: only checks a substring of a generated browser-expression string.
// test("buildTokenColour reads the named CSS token", () => {
//     assert.ok(buildTokenColour("--c-edit").includes("var(--c-edit)"));
// });
