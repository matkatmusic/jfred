// Linear state sequence driven via in-page eval, not synthesized mouse events.
//
// Each step exercises the page's own click handlers, not computed coordinates.

import type { HeadlessPage } from "./cdp.ts";
import { pause } from "./cdp.ts";

// A drawer open waits on a file fetch; everything else is a synchronous re-render.
const RENDER_TIMEOUT_MS = 20_000;

// Extra pause after app settles so layout and scroll offsets land before measuring rectangles.
const SETTLE_MS = 600;

export interface VisualState {
    name: string;
    // Put the page into this state. The first state is reached by the navigation itself.
    drive: (page: HeadlessPage) => Promise<void>;
}

// The page has finished its ~10 s build and drawn bubbles.
export const READY_EXPRESSION = "document.querySelectorAll('#stage .filebox').length > 0";

// Click the folder row, not the expand triangle — the two are distinct targets (task 253).
const CLICK_FIRST_FOLDER = `(() => {
    const summary = document.querySelector('#filenav-tree summary.file-folder-name');
    if (summary === null) { return false; }
    summary.click();
    return true;
})()`;

// Open Detail View on the first non-bucket pair bubble's node.
const CLICK_FIRST_NODE = `(() => {
    const node = document.querySelector('#stage .filebox:not(.bucket) .node');
    if (node === null) { return false; }
    node.click();
    return true;
})()`;

// Unfilter by re-clicking the selected folder so the ruler has multi-event rows to expand.
const CLEAR_FOLDER_FILTER = `(() => {
    const selected = document.querySelector('#filenav-tree summary.file-folder-name.selected');
    if (selected === null) { return false; }
    selected.click();
    return true;
})()`;

// Expand a shared gutter row; `.multi` guarantees the row is expandable.
const CLICK_MULTI_TICK = `(() => {
    const tick = document.querySelector('#ruler .tick.multi');
    if (tick === null) { return false; }
    tick.click();
    return true;
})()`;

// Jump to the last bubble — the furthest right, most likely to land off-screen.
const JUMP_TO_LAST_BUBBLE = `(() => {
    const names = [...document.querySelectorAll('#stage .filebox:not(.bucket) .fname')];
    const last = names[names.length - 1];
    if (last === undefined) { return false; }
    const box = document.getElementById('find-file');
    box.value = last.dataset.path;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
})()`;

// Zoom out ~51% so a full column is visible and mis-scaled boxes can collide.
const ZOOM_OUT_THREE_STEPS = `(() => {
    const button = document.getElementById('zoom-out');
    button.click();
    button.click();
    button.click();
    return true;
})()`;

// Throws if the page has nothing to click, preventing a meaningless duplicate state.
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

