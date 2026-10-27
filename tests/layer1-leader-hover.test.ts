// Task 290: hovering a leader line highlights its visible targets; tests assert the `aimed` class, stubbing getBoundingClientRect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

// One placed moment as the endpoint ships it: absolute ruler offsets, no time arithmetic anywhere.
interface FixtureInstant {
    instant: string;
    axisPx: number;
}

// SHARED_PX: the second bubble begins there, the first holds an interior node; offsets clear the 13 px threshold.
const EARLY_PX = 10;
const SHARED_PX = 40;
const LATE_PX = 110;

const AT_EARLY: FixtureInstant = { instant: "2026-06-01T09:00:00.000Z", axisPx: EARLY_PX };
const AT_SHARED: FixtureInstant = { instant: "2026-06-04T09:00:00.000Z", axisPx: SHARED_PX };
const AT_LATE: FixtureInstant = { instant: "2026-06-11T09:00:00.000Z", axisPx: LATE_PX };

// REAL 40-character hashes, as tests/layer1-page.test.ts uses, so a broken label truncation cannot pass unnoticed.
const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";

// Drawn FIRST, and it begins EARLIER: the shared instant is only an interior node of this one.
const SPANNING_PAIR = {
    path: "src/spanning.ts",
    commits: [{ ...AT_EARLY, hash: EARLY_HASH }, { ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Drawn SECOND and begins on the shared instant, so the hover's targets include a `.filebox` and the node.
const BEGINNING_PAIR = {
    path: "src/beginning.ts",
    commits: [{ ...AT_SHARED, hash: SHARED_HASH }],
    onDisk: AT_LATE,
};

// Both pairs on one ruler; each entry needs task 275's event count; one leader line per entry.
function buildSharedInstantView(): object {
    return {
        pairs: [SPANNING_PAIR, BEGINNING_PAIR],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [
            { ...AT_EARLY, eventCount: 1 },
            { ...AT_SHARED, eventCount: 2 },
            { ...AT_LATE, eventCount: 2 },
        ],
    };
}

// Only the four edges are read, so a plain box is enough: happy-dom has no layout.
function makeRect(left: number, top: number, right: number, bottom: number): DOMRect {
    return { left, top, right, bottom, width: right - left, height: bottom - top } as unknown as DOMRect;
}

// One box every element shares and one only the PANE gets: vertically disjoint, so targets sit outside the scrollport.
const ON_SCREEN = makeRect(0, 0, 900, 600);
const SCROLLED_PAST_TARGETS = makeRect(0, 2000, 900, 2600);

function stubEveryRectOnScreen(): void {
    HTMLElement.prototype.getBoundingClientRect = () => ON_SCREEN;
}

function stubPaneScrolledAwayFromTargets(): void {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        return this.id === "timelines" ? SCROLLED_PAST_TARGETS : ON_SCREEN;
    };
}

// Boot a fresh page at a deep link with the view stubbed; initLayer1Page runs explicitly.
async function loadPageWithView(view: object): Promise<void> {
    initLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
    stubStreamRoute("/api/layer1-view", [view]);
    const { initLayer1Page } = await import("../webapp/layer1-page.ts");
    initLayer1Page();
    await waitForAsyncWork();
}

// The dashed line drawn for one absolute offset; it fails loudly, since a missing line means nothing is tested.
function findLeaderAt(axisPx: number): HTMLElement {
    const leader = [...document.querySelectorAll<HTMLElement>("#leaders .leader")]
        .find((line) => line.style.getPropertyValue("--axis-px") === String(axisPx));
    assert.ok(leader, `no leader line was drawn at ${axisPx}px`);
    return leader;
}

function listAimedElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(".aimed")];
}

// The widget-relative offset an element was drawn at — the value the target lookup matches on.
function readAxisPx(element: HTMLElement): number {
    return Number(element.style.getPropertyValue("--axis-px"));
}

test("test_hovering_a_leader_line_highlights_every_visible_target_at_its_instant", async () => {
    // Task 290: a leader marks the nodes at its instant in every bubble touching it, never the bubble box.
    await loadPageWithView(buildSharedInstantView());
    stubEveryRectOnScreen();
    // mouse onto the line at the instant beginning.ts begins at and spanning.ts holds a commit on.
    findLeaderAt(SHARED_PX).dispatchEvent(new window.Event("pointerenter"));
    // the line itself is recoloured...
    assert.ok(findLeaderAt(SHARED_PX).classList.contains("aimed"), "the hovered line was not recoloured");
    // ...no bubble is marked, only dots...
    assert.equal(document.querySelector(".filebox.aimed"), null, "a bubble was marked instead of a dot");
    // ...and BOTH dots at that instant are: beginning.ts's first node and spanning.ts's interior node.
    const litNodes = [...document.querySelectorAll<HTMLElement>(".node.aimed")];
    const names = litNodes.map((node) => node.closest(".filebox")?.querySelector(".fname")?.textContent);
    // sorted, because WHICH bubble is drawn first is a render detail and not this module's promise.
    assert.deepEqual(names.sort(), ["beginning.ts", "spanning.ts"]);
    for (const node of litNodes) {
        assert.equal(readAxisPx(node.closest(".filebox") as HTMLElement) + readAxisPx(node), SHARED_PX);
    }
});

test("test_leaving_a_leader_line_drops_the_highlight", async () => {
    // Task 290: hover covers many elements, so leaving must darken everything that entering lit.
    await loadPageWithView(buildSharedInstantView());
    stubEveryRectOnScreen();
    const leader = findLeaderAt(SHARED_PX);
    leader.dispatchEvent(new window.Event("pointerenter"));
    assert.ok(listAimedElements().length > 0, "nothing was highlighted to begin with");
    // mouse off it again.
    leader.dispatchEvent(new window.Event("pointerleave"));
    // nothing anywhere on the page is still marked, the line included.
    assert.deepEqual(listAimedElements(), []);
});

test("test_a_leader_whose_targets_are_scrolled_away_stays_unhighlighted", async () => {
    // Task 290: a line whose targets scrolled out of the pane must stay grey.
    await loadPageWithView(buildSharedInstantView());
    stubPaneScrolledAwayFromTargets();
    // hover the line whose two targets are now outside the scrollport.
    findLeaderAt(SHARED_PX).dispatchEvent(new window.Event("pointerenter"));
    // nothing is marked — not the targets, and not the hovered line either.
    assert.deepEqual(listAimedElements(), []);
});
