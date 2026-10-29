// Capture-free tests for the Layer 2 centring probe scripts and the centring line they print.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CENTRE_TOLERANCE_PX, EDGE_TOLERANCE_PX, PROBE, formatCentreLine, markProbe, readView, type CentredView } from "../scripts/visual/layer2-centre-probes.ts";

const VIEW: CentredView = {
    node: [150, 150, 250, 250], area: [0, 0, 400, 400], pane: [0, 0, 400, 400], drawer: [400, 0, 600, 400],
    scroll: [100, 100], maxScroll: [500, 500], offset: [0, 0], isInside: true, touchesDrawer: false,
};

test("the tolerances are the documented pixel slacks", () => {
    assert.equal(CENTRE_TOLERANCE_PX, 4);
    assert.equal(EDGE_TOLERANCE_PX, 1);
});

test("readView measures the node chosen by the selector", () => {
    assert.ok(readView(PROBE).includes(`const node = ${PROBE};`));
});

test("markProbe searches for an interior node or a clamped node", () => {
    assert.ok(markProbe(true).includes("find(isInterior)"));
    assert.ok(markProbe(false).includes("find(isClamped)"));
});

test("formatCentreLine prints both centres, the offset and the scroll position", () => {
    const line = formatCentreLine("node click", VIEW);
    assert.ok(line.startsWith("CENTRE node click: node centre (200, 200) area centre (200, 200) offset [0,0]"));
    assert.ok(line.includes("scroll [100,100] of [500,500]"));
});
