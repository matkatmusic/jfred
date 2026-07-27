// The scripted state sequence the Layer 1 viewer is driven through. Linear on purpose: each state
// is reached from the one before it, so the run also exercises what a real reader does — filter,
// open something, expand a row, jump, then pull back to see the whole render.
//
// Every drive step is an expression evaluated IN THE PAGE, because the page's own click handlers
// are what the states are testing; synthesising CDP mouse events at computed coordinates would test
// the coordinates instead.

import type { HeadlessPage } from "./cdp.ts";
import { pause } from "./cdp.ts";

// A drawer open waits on a file fetch; everything else is a synchronous re-render.
const RENDER_TIMEOUT_MS = 20_000;

// After the app reports itself settled, one more beat for layout and scrolling to land before any
// rectangle is measured.
const SETTLE_MS = 600;

export interface VisualState {
    name: string;
    // Put the page into this state. The first state is reached by the navigation itself.
    drive: (page: HeadlessPage) => Promise<void>;
}

// The page has finished its ~10 s build and drawn bubbles.
export const READY_EXPRESSION = "document.querySelectorAll('#stage .filebox').length > 0";

// Click the first folder ROW in the File Nav — never its expand triangle, which is a real element
// precisely so the two clicks are distinguishable (task 253). Clicking the <summary> itself makes
// `event.target` the summary, which is the select-the-folder path.
const CLICK_FIRST_FOLDER = `(() => {
    const summary = document.querySelector('#filenav-tree summary.file-folder-name');
    if (summary === null) { return false; }
    summary.click();
    return true;
})()`;

// Open the Detail View on the first real pair bubble's first node. Buckets are skipped: they draw
// no .node at all, so they have nothing to open.
const CLICK_FIRST_NODE = `(() => {
    const node = document.querySelector('#stage .filebox:not(.bucket) .node');
    if (node === null) { return false; }
    node.click();
    return true;
})()`;

// Re-click the selected folder, which drops the filter and restores the whole view (task 253).
// The ruler state needs this: one folder's files rarely share an instant, so a FILTERED view has no
// multi-event row to expand — and testing the expansion on a view that cannot expand tests nothing.
const CLEAR_FOLDER_FILTER = `(() => {
    const selected = document.querySelector('#filenav-tree summary.file-folder-name.selected');
    if (selected === null) { return false; }
    selected.click();
    return true;
})()`;

// Expand a gutter row that several events share. `.multi` is the class markMultiEventTicks puts on
// exactly the rows a click would open, so this can never click a row that refuses to expand.
const CLICK_MULTI_TICK = `(() => {
    const tick = document.querySelector('#ruler .tick.multi');
    if (tick === null) { return false; }
    tick.click();
    return true;
})()`;

// Jump to the LAST pair bubble, the one furthest right across a ~156,000 px stage — the jump most
// likely to leave its target off screen, which is the failure this state exists to catch.
const JUMP_TO_LAST_BUBBLE = `(() => {
    const names = [...document.querySelectorAll('#stage .filebox:not(.bucket) .fname')];
    const last = names[names.length - 1];
    if (last === undefined) { return false; }
    const box = document.getElementById('find-file');
    box.value = last.dataset.path;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
})()`;

// Three clicks of the 1.25x control — ~51%, far enough out that a whole column of the render is on
// screen at once and a mis-scaled box has somewhere to collide.
const ZOOM_OUT_THREE_STEPS = `(() => {
    const button = document.getElementById('zoom-out');
    button.click();
    button.click();
    button.click();
    return true;
})()`;

// Run one in-page action, refusing to continue if the page had nothing to click. A silent no-op here
// would produce a state identical to the previous one and a pass that means nothing.
async function clickInPage(page: HeadlessPage, expression: string, what: string): Promise<void> {
    if (!await page.evaluate<boolean>(expression)) {
        throw new Error(`state cannot be reached: the page has no ${what}`);
    }
}

// Wait for the app to settle, then let layout and scrolling land.
async function settle(page: HeadlessPage, expression: string): Promise<void> {
    await page.waitFor(expression, RENDER_TIMEOUT_MS);
    await pause(SETTLE_MS);
}

export const VISUAL_STATES: VisualState[] = [
    {
        name: "01-initial-load",
        drive: async (page) => settle(page, READY_EXPRESSION),
    },
    {
        name: "02-folder-filter",
        drive: async (page) => {
            await clickInPage(page, CLICK_FIRST_FOLDER, "folder row in the File Nav");
            await settle(page, READY_EXPRESSION);
        },
    },
    {
        name: "03-file-selected",
        drive: async (page) => {
            await clickInPage(page, CLICK_FIRST_NODE, "pair bubble with a node");
            await settle(page, "document.querySelector('#drawer.open') && document.getElementById('dpath').textContent");
        },
    },
    {
        name: "04-ruler-expanded",
        drive: async (page) => {
            await clickInPage(page, CLEAR_FOLDER_FILTER, "selected folder to unfilter");
            await settle(page, READY_EXPRESSION);
            await clickInPage(page, CLICK_MULTI_TICK, "multi-event ruler row");
            await settle(page, "document.querySelector('#ruler .tickfiles button')");
        },
    },
    {
        name: "05-jump-to-bubble",
        drive: async (page) => {
            await clickInPage(page, JUMP_TO_LAST_BUBBLE, "pair bubble to jump to");
            await settle(page, "document.querySelector('#stage .filebox.found')");
        },
    },
    {
        name: "06-zoomed-out",
        drive: async (page) => {
            await clickInPage(page, ZOOM_OUT_THREE_STEPS, "zoom control");
            await settle(page, "document.getElementById('zoom-level').textContent !== '100%'");
        },
    },
];
