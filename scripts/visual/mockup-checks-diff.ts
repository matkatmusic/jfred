// Tasks #324/#325/#326 + #329: the DiffView pane's pair behaviours, the nav's on-disk click, Show Only.

// Its own file because mockup-checks.ts is at the 250-line cap; run order lives in mockup.ts.

import { type HeadlessPage } from "./cdp.ts";
import { check } from "./mockup-checks.ts";

// A bubble with at least four clickable nodes, so a pair has somewhere to step to between its ends.
const RICH_PATH = `(() => {
    const box = [...document.querySelectorAll('.filebox[data-path]')]
        .find(b => b.querySelectorAll('.node:not(.n-created)').length >= 4);
    return box?.dataset.path ?? null;
})()`;

// The marker vocabulary a pane speaks for a lane node (layer1-revision-sources.ts).
const MARKER_OF = `(dot => dot.classList.contains('n-commit') && dot.title ? dot.title.slice(0, 8)
    : dot.classList.contains('n-snap') ? '@v' + dot.dataset.version + ' 📸' : 'on disk')`;

// Clicks the Nth clickable node of a bubble; `shift` extends a selection into a pair (#305).
const clickNode = (path: string, index: number, shift = false) => `(() => {
    const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
    const dot = [...box.querySelectorAll('.node:not(.n-created)')][${index}];
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }));
    return ${MARKER_OF}(dot);
})()`;

const PANE = `document.querySelector('#dbody details.dfile')`;
const PANE_LABEL = `${PANE}.querySelector('.dpair').textContent`;
const paneArrow = (index: number) => `[...${PANE}.querySelectorAll('summary .dtools button')][${index}]`;
const ringMarker = (cls: string) =>
    `(() => { const dot = document.querySelector('.${cls}'); return dot ? ${MARKER_OF}(dot) : null; })()`;
const PANE_SETTLED =
    `${PANE}.querySelectorAll('.dfile-body .diff-line, .dfile-body .diff-cols, .dfile-body .dbinary').length > 0`;
const INLINE_ROWS = `${PANE}.querySelectorAll('.dfile-body .diff-line').length`;

// ---- task #324 (now #329's pane) ----------------------------------------------------------------
export async function checkDiffPair(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    check("#324 the fixture has a bubble with enough nodes to step a pair through", path !== null);
    if (path === null) {
        return;
    }
    // A plain click is the SINGLE-revision pane: controls hidden, node-step arrows shown.
    await page.evaluate(clickNode(path, 0));
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#329 a single-node click shows a pane with hidden revision controls",
        await page.evaluate<boolean>(`${paneArrow(0)}.hidden && !document.getElementById('dprev').hidden`));

    const baseName = await page.evaluate<string>(clickNode(path, 0));
    const targetName = await page.evaluate<string>(clickNode(path, 3, true));
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#324 shift-click opens the pair pane: its arrows appear and the single arrows go away",
        await page.evaluate<boolean>(`!${paneArrow(0)}.hidden && document.getElementById('dprev').hidden`));
    check("#324 the pane label reads '<base> - <target>'",
        await page.evaluate<string>(PANE_LABEL) === `${baseName} - ${targetName}`,
        { baseName, targetName, shown: await page.evaluate<string>(PANE_LABEL) });
    check("#324 the lane marks the two ends as base and target",
        await page.evaluate<string | null>(ringMarker("diff-base")) === baseName
        && await page.evaluate<string | null>(ringMarker("diff-target")) === targetName);
    check("#324 the pair's marks REPLACE the single selection's [ ] brackets",
        await page.evaluate<number>(`document.querySelectorAll('.node.found').length`) === 0);

    // Direction comes from axis position, never click order: clicking upwards must match downwards.
    await page.evaluate(clickNode(path, 3));
    await page.evaluate(clickNode(path, 0, true));
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#324 the pair's direction comes from the axis, not the click order",
        await page.evaluate<string | null>(ringMarker("diff-base")) === baseName
        && await page.evaluate<string | null>(ringMarker("diff-target")) === targetName);
}

// ---- task #324's four arrows, now pane-owned ----------------------------------------------------
export async function checkPairArrows(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    if (path === null) {
        return;
    }
    const names = await page.evaluate<string[]>(`(() => {
        const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
        return [...box.querySelectorAll('.node:not(.n-created)')].map(${MARKER_OF});
    })()`);
    await page.evaluate(clickNode(path, 0));
    await page.evaluate(clickNode(path, 3, true));
    await page.waitFor(PANE_SETTLED, 10_000);

    await page.evaluate(`${paneArrow(1)}.click()`);
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#324 the base arrow moves the BASE and leaves the target alone",
        await page.evaluate<string | null>(ringMarker("diff-base")) === names[1]
        && await page.evaluate<string | null>(ringMarker("diff-target")) === names[3]);
    check("#324 the pane label follows the moved base",
        await page.evaluate<string>(PANE_LABEL) === `${names[1]} - ${names[3]}`);

    await page.evaluate(`${paneArrow(2)}.click()`);
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#324 the target arrow moves the TARGET and leaves the base alone",
        await page.evaluate<string | null>(ringMarker("diff-base")) === names[1]
        && await page.evaluate<string | null>(ringMarker("diff-target")) === names[2]);

    // Task 329: stepping ONTO the other side is allowed — equal sides read as one revision.
    await page.evaluate(`${paneArrow(1)}.click()`);
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#329 equal sides collapse the label to the one revision",
        await page.evaluate<string>(PANE_LABEL) === names[2]);

    // Walk the base back to the top of the lane; its "previous" arrow must then stop, not wrap.
    await page.evaluate(`${paneArrow(0)}.click()`);
    await page.evaluate(`${paneArrow(0)}.click()`);
    await page.waitFor(`${paneArrow(0)}.disabled`, 10_000);
    check("#324 an arrow at the lane's end STOPS rather than wrapping round",
        await page.evaluate<string | null>(ringMarker("diff-base")) === names[0]
        && await page.evaluate<boolean>(`${paneArrow(0)}.disabled`));
}

// ---- tasks #319/#320: the pane's tools row -------------------------------------------------------
export async function checkDiffTools(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    if (path === null) {
        return;
    }
    await page.evaluate(clickNode(path, 0));
    await page.evaluate(clickNode(path, 3, true));
    await page.waitFor(PANE_SETTLED, 10_000);
    check("#319 the pair opens side-by-side, in two columns",
        await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 1
        && await page.evaluate<boolean>(
            `${PANE}.querySelector('button[data-mode="side"]').classList.contains('current')`));
    check("#319 the two revisions actually differ, so there is a diff to look at",
        await page.evaluate<number>(
            `${PANE}.querySelectorAll('.dfile-body .dc-add, .dfile-body .dc-del').length`) > 0);

    await page.evaluate(`${PANE}.querySelector('button[data-mode="inline"]').click()`);
    check("#319 inline is ONE column and paints the current button",
        await page.evaluate<number>(INLINE_ROWS) > 0
        && await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 0
        && await page.evaluate<boolean>(
            `${PANE}.querySelector('button[data-mode="inline"]').classList.contains('current')`));

    const narrow = await page.evaluate<number>(INLINE_ROWS);
    await page.evaluate(`(() => { const f = ${PANE}.querySelector('.dfull-toggle input');
        f.checked = true; f.dispatchEvent(new Event('change')); })()`);
    await page.waitFor(`${INLINE_ROWS} > ${narrow}`, 10_000);
    check("#320 'full content' WIDENS the same diff rather than replacing it",
        await page.evaluate<number>(INLINE_ROWS) > narrow, { narrow });

    // Back to the state the rest of the run expects.
    await page.evaluate(`(() => { const f = ${PANE}.querySelector('.dfull-toggle input');
        f.checked = false; f.dispatchEvent(new Event('change')); })()`);
    await page.waitFor(`${INLINE_ROWS} === ${narrow}`, 10_000);
    await page.evaluate(`${PANE}.querySelector('button[data-mode="side"]').click()`);
    check("#319 turning full content off restores the windowed diff",
        await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 1);
}

// A shift-click on a DIFFERENT bubble is refused out loud (#305), and the shown pair is untouched.
export async function checkCrossBubbleRefusal(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    const other = await page.evaluate<string | null>(`(() => {
        const box = [...document.querySelectorAll('.filebox[data-path]')]
            .find(b => b.dataset.path !== ${JSON.stringify(path)} && b.querySelector('.node:not(.n-created)'));
        return box?.dataset.path ?? null;
    })()`);
    if (path === null || other === null) {
        return;
    }
    await page.evaluate(clickNode(path, 0));
    await page.evaluate(clickNode(path, 3, true));
    await page.waitFor(PANE_SETTLED, 10_000);
    const before = await page.evaluate<string>(PANE_LABEL);
    await page.evaluate(clickNode(other, 0, true));
    check("#305 a shift-click on another bubble is refused VISIBLY",
        await page.evaluate<boolean>(`!document.getElementById('dtoast').hidden`)
        && (await page.evaluate<string>(`document.getElementById('dtoast').textContent`)).includes("ONE bubble"));
    check("#305 the refused click leaves the shown pair exactly as it was",
        await page.evaluate<string>(PANE_LABEL) === before);
}

// ---- task #325 -----------------------------------------------------------------------------------
export async function checkNavOpensDiskNode(page: HeadlessPage): Promise<void> {
    // The trap case: created-at also carries `.n-disk`, sorts first, and is inert.
    const path = await page.evaluate<string | null>(`(() => {
        const box = [...document.querySelectorAll('.filebox[data-path]')]
            .find(b => b.querySelector('.node.n-created'));
        return box?.dataset.path ?? null;
    })()`);
    check("#325 the fixture has a file with a created-at node to test against", path !== null);
    if (path === null) {
        return;
    }
    await page.evaluate(`document.getElementById('dclose').click()`);
    await page.evaluate(`(() => {
        const want = ${JSON.stringify(path)};
        [...document.querySelectorAll('#filenav-tree .file-item')]
            .find(i => i.title === want || i.title === want + ' (deleted)').click();
    })()`);
    await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, 10_000);
    check("#325 it shows the file's ON-DISK state",
        (await page.evaluate<string>(`document.getElementById('dpath').textContent`)).includes("Current on-disk state"));
    await page.waitFor(`document.querySelectorAll('.node.found').length === 1`, 10_000);
    check("#325 the on-disk node is the one selected, never the inert created-at",
        await page.evaluate<boolean>(`(() => {
            const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
            return box.querySelector('.node.n-disk:not(.n-created)').classList.contains('found')
                && !box.querySelector('.node.n-created').classList.contains('found');
        })()`));
}

// ---- task #326 -----------------------------------------------------------------------------------
const bubbleCount = `document.querySelectorAll('.filebox[data-path]').length`;
const clickFirstFolder = `(() => {
    const folder = document.querySelector('#filenav-tree .file-folder-name');
    folder.click();
    return folder.textContent;
})()`;

export async function checkShowOnlySelected(page: HeadlessPage): Promise<void> {
    await page.evaluate(`document.getElementById('dclose').click()`);
    const all = await page.evaluate<number>(bubbleCount);
    const folder = await page.evaluate<string | null>(clickFirstFolder);
    check("#326 the fixture nests its files, so there is a folder to select", folder !== null);

    await page.evaluate(`document.getElementById('filenav-only-selected').click()`);
    await page.waitFor(`${bubbleCount} < ${all}`, 10_000);
    const filtered = await page.evaluate<number>(bubbleCount);
    check("#326 the toggle narrows the timeline to the selected folder", filtered > 0 && filtered < all,
        { all, filtered });
    check("#326 the toggle paints itself as active",
        await page.evaluate<boolean>(
            `document.getElementById('filenav-only-selected').classList.contains('current')`));

    await page.evaluate(`document.getElementById('filenav-only-selected').click()`);
    await page.waitFor(`${bubbleCount} === ${all}`, 10_000);
    check("#326 turning it off restores every file", await page.evaluate<number>(bubbleCount) === all);
    // Clear the folder selection (a plain click on the selected folder clears it, #254's rule).
    await page.evaluate(clickFirstFolder);
}

// ---- File Nav bugs reported 2026-07-29 -----------------------------------------------------------
export async function checkNavBugs(page: HeadlessPage): Promise<void> {
    // A deleted file has no bubble, so the clicked ROW is the only answer a click can give.
    const deleted = await page.evaluate<string | null>(
        `document.querySelector('#filenav-tree .file-item.deleted')?.title?.replace(' (deleted)', '') ?? null`);
    check("the fixture lists a deleted file", deleted !== null);
    if (deleted !== null) {
        await page.evaluate(`document.querySelector('#filenav-tree .file-item.deleted').click()`);
        check("clicking a DELETED file marks its File Nav row as selected",
            await page.evaluate<boolean>(
                `document.querySelector('#filenav-tree .file-item.deleted').classList.contains('selected')`));
    }
    await page.evaluate(
        `[...document.querySelectorAll('#filenav-tree .file-item')].find(i => !i.classList.contains('deleted')).click()`);
    check("selecting another row clears the previous one — one nav selection at a time",
        await page.evaluate<number>(`document.querySelectorAll('#filenav-tree .file-item.selected').length`) === 1);

    // The triangle must COLLAPSE the folder; the name beside it must still filter instead.
    const openBefore = await page.evaluate<boolean>(
        `document.querySelector('#filenav-tree .file-folder').open`);
    await page.evaluate(`document.querySelector('#filenav-tree .file-folder > summary > .file-folder-toggle').click()`);
    check("the folder triangle actually collapses the folder",
        openBefore && await page.evaluate<boolean>(`!document.querySelector('#filenav-tree .file-folder').open`));
    await page.evaluate(`document.querySelector('#filenav-tree .file-folder > summary > .file-folder-toggle').click()`);
    check("the triangle expands it again",
        await page.evaluate<boolean>(`document.querySelector('#filenav-tree .file-folder').open`));
    check("clicking the triangle does NOT select the folder",
        await page.evaluate<number>(
            `document.querySelectorAll('#filenav-tree .file-folder-name.selected').length`) === 0);
}
