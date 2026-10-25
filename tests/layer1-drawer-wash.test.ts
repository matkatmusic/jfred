// Cross-bubble shift-click ranges and the wash sweep; the stage is built by hand, matching layer1-page.ts's DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView, rememberNavTargets } from "../webapp/layer1-diff-wash.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
    DISK_FILE_CONTENT, DISK_FILE_PATH, LANE_T0, LANE_T1, LANE_T2, installAnimationFrameStub, installRecordingFetch,
    waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

test("task 329: a shift-click spanning two bubbles becomes a global range diffing both files", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    const firstNode = el("i", { class: "node n-disk" });
    const otherNode = el("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
            el("div", { class: "lane" }, [firstNode]),
        ]),
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "other.ts", "data-path": "src/other.ts" }),
            el("div", { class: "lane" }, [otherNode]),
        ]),
    );
    rememberDrawnView({
        pairs: [
            { path: DISK_FILE_PATH, commits: [], onDisk: { instant: LANE_T0, axisPx: 10 } },
            { path: "src/other.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 } },
        ],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ instant: LANE_T0, axisPx: 10, eventCount: 1 }, { instant: LANE_T2, axisPx: 40, eventCount: 1 }],
    } as WireLayer1View);
    rememberNavTargets([]);
    wireNodeDrawer();

    firstNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    const diffsBefore = asks.filter((ask) => ask.url.includes("layer1-diff-content")).length;
    otherNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await waitForPendingFetches();

    // One section per file, each posting its own diff; no refusal toast anywhere.
    assert.equal(asks.filter((ask) => ask.url.includes("layer1-diff-content")).length, diffsBefore + 2);
    assert.equal(getRequiredElementById("dbody").querySelectorAll("details.dfile").length, 2);
    assert.equal(getRequiredElementById("dpath").textContent, "2 files — range diff");
    assert.ok(getRequiredElementById("washes").querySelector(".diff-wash"));
    assert.equal(getRequiredElementById("dtoast").hidden, true);
});

test("task 336: the wash sweeps in every file with a step inside the range, not just the two clicked", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    const firstNode = el("i", { class: "node n-disk" });
    const otherNode = el("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
            el("div", { class: "lane" }, [firstNode]),
        ]),
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "other.ts", "data-path": "src/other.ts" }),
            el("div", { class: "lane" }, [otherNode]),
        ]),
    );
    rememberDrawnView({
        pairs: [
            { path: DISK_FILE_PATH, commits: [], onDisk: { instant: LANE_T0, axisPx: 10 } },
            { path: "src/other.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 } },
            // Untouched by any click, but its own step (LANE_T1) sits inside LANE_T0..LANE_T2.
            { path: "src/swept.ts", commits: [], onDisk: { instant: LANE_T1, axisPx: 25 } },
            // Untouched, and its step post-dates the range entirely — must stay out of the drawer.
            { path: "src/excluded.ts", commits: [], onDisk: { instant: "2026-07-01T13:00:00.000Z", axisPx: 60 } },
        ],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [
            { instant: LANE_T0, axisPx: 10, eventCount: 1 },
            { instant: LANE_T1, axisPx: 25, eventCount: 1 },
            { instant: LANE_T2, axisPx: 40, eventCount: 1 },
        ],
    } as WireLayer1View);
    rememberNavTargets([]);
    wireNodeDrawer();

    firstNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    otherNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await waitForPendingFetches();

    // 3 panes: the two clicked files plus the swept-in one; the out-of-range file never shows up.
    assert.equal(getRequiredElementById("dbody").querySelectorAll("details.dfile").length, 3);
    assert.equal(getRequiredElementById("dpath").textContent, "3 files — range diff");
});
