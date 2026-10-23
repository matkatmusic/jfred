// A chunked redraw after the first Edit tick must not close the open ruler row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
setupLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-page.ts");
const { readRulerExpansion } = await import("../webapp/layer1-tick-files.ts");

const FILLER = { instant: "2026-06-01T09:00:00.000Z", axisPx: 10 };
const ROW = { instant: "2026-06-02T09:00:00.000Z", axisPx: 100 };
const ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 200 };
const FILLER_PAIR_COUNT = 110;
const ROW_PAIR_COUNT = 2;

function buildPair(name: string, commitAt: typeof FILLER) {
    return { path: `src/${name}.ts`, commits: [{ ...commitAt, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" }], onDisk: ON_DISK };
}

// The row's two events sit past the first 100 widgets, so the partial stage shows none of them.
function buildChunkedView(): never {
    const fillers = Array.from({ length: FILLER_PAIR_COUNT }, (_, index) => buildPair(`filler-${index}`, FILLER));
    const rowPairs = Array.from({ length: ROW_PAIR_COUNT }, (_, index) => buildPair(`row-${index}`, ROW));
    return {
        pairs: [...fillers, ...rowPairs],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [
            { ...FILLER, eventCount: FILLER_PAIR_COUNT },
            { ...ROW, eventCount: ROW_PAIR_COUNT },
            { ...ON_DISK, eventCount: FILLER_PAIR_COUNT + ROW_PAIR_COUNT },
        ],
    } as never;
}

// Chunked renders paint a frame per chunk, so a few turns lets every redraw finish.
async function settleRedraws(): Promise<void> {
    for (let turn = 0; turn < 10; turn++) {
        await waitForAsyncWork();
    }
}

function listOpenRowButtons(): Element[] {
    return [...document.querySelectorAll(".tick.expanded .tickfiles button")];
}

test("test_ticking_the_edit_box_during_a_chunked_redraw_keeps_the_open_ruler_row", async () => {
    setupLayer1Dom();
    stubStreamRoute("/api/layer1-edits", [{ pairs: [] }]);
    await renderLayer1View(buildChunkedView());
    const tick = [...document.querySelectorAll<HTMLElement>("#ruler .tick.multi")].find((candidate) => candidate.textContent!.endsWith("(2)"))!;
    tick.click();
    await settleRedraws();
    assert.ok(document.querySelectorAll(".tickfiles button").length >= 2);
    const box = document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!;
    box.checked = true;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settleRedraws();
    assert.notEqual(readRulerExpansion(), undefined);
    assert.ok(listOpenRowButtons().length >= 2);
});
