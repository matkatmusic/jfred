// Tasks #324/#325/#326: the pair header and arrows, the nav's on-disk click, the Show Only toggle.

// Its own file because mockup-checks.ts is at the 250-line cap; run order lives in mockup.ts.

import { type HeadlessPage } from "./cdp.ts";
import { check } from "./mockup-checks.ts";

// A bubble with at least three clickable nodes, so a pair has somewhere to step to between its ends.
const RICH_PATH = `(() => {
    const box = [...document.querySelectorAll('.filebox[data-path]')]
        .find(b => b.querySelectorAll('.node:not(.n-created)').length >= 4);
    return box?.dataset.path ?? null;
})()`;

// Clicks the Nth clickable node of a bubble. `shift` is what extends a selection into a pair (#305).
const clickNode = (path: string, index: number, shift = false) => `(() => {
    const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
    const dot = [...box.querySelectorAll('.node:not(.n-created)')][${index}];
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }));
    return dot.dataset.event;
})()`;

const hidden = (id: string) => `document.getElementById(${JSON.stringify(id)}).hidden`;
const textOf = (id: string) => `document.getElementById(${JSON.stringify(id)}).textContent`;
const markedEvent = (cls: string) =>
    `document.querySelector('.${cls}')?.dataset.event ?? null`;
const bodyRows = `document.querySelectorAll('#dbody .dcell').length`;

// ---- task #324 ---------------------------------------------------------------------------------
export async function checkDiffPair(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    check("#324 the fixture has a bubble with enough nodes to step a pair through", path !== null);
    if (path === null) {
        return;
    }
    // A plain click is the SINGLE-node view: row 2 and the pair arrows stay away.
    await page.evaluate(clickNode(path, 0));
    check("#324 a single-node click shows the single-node arrows and no diff row",
        await page.evaluate<boolean>(`${hidden("pairtools")} && ${hidden("dhead2")}
            && !document.getElementById('dprev').hidden`));

    const baseName = await page.evaluate<string>(clickNode(path, 0));
    const targetName = await page.evaluate<string>(clickNode(path, 3, true));
    check("#324 shift-click opens the pair: row 2 appears and the single arrows go away",
        await page.evaluate<boolean>(`!${hidden("pairtools")} && !${hidden("dhead2")}
            && document.getElementById('dprev').hidden`));
    check("#324 row 1 reads '<base> - <target>'",
        await page.evaluate<string>(textOf("dpairlabel")) === `${baseName} - ${targetName}`,
        { baseName, targetName, shown: await page.evaluate<string>(textOf("dpairlabel")) });
    check("#324 the lane marks the two ends as base and target",
        await page.evaluate<string | null>(markedEvent("diff-base")) === baseName
        && await page.evaluate<string | null>(markedEvent("diff-target")) === targetName);
    check("#324 the pair's marks REPLACE the single selection's [ ] brackets",
        await page.evaluate<number>(`document.querySelectorAll('.node.found').length`) === 0);

    // Direction comes from axis position, never click order: clicking upwards must match downwards.
    await page.evaluate(clickNode(path, 3));
    await page.evaluate(clickNode(path, 0, true));
    check("#324 the pair's direction comes from the axis, not the click order",
        await page.evaluate<string | null>(markedEvent("diff-base")) === baseName
        && await page.evaluate<string | null>(markedEvent("diff-target")) === targetName);
}

// ---- task #324's four arrows --------------------------------------------------------------------
export async function checkPairArrows(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    if (path === null) {
        return;
    }
    const names = await page.evaluate<string[]>(`(() => {
        const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
        return [...box.querySelectorAll('.node:not(.n-created)')].map(n => n.dataset.event);
    })()`);
    // Base on the first node, target on the fourth: two free steps between them.
    await page.evaluate(clickNode(path, 0));
    await page.evaluate(clickNode(path, 3, true));

    await page.evaluate(`document.getElementById('dbnext').click()`);
    check("#324 the base arrow moves the BASE and leaves the target alone",
        await page.evaluate<string | null>(markedEvent("diff-base")) === names[1]
        && await page.evaluate<string | null>(markedEvent("diff-target")) === names[3]);
    check("#324 the header follows the moved base",
        await page.evaluate<string>(textOf("dpairlabel")) === `${names[1]} - ${names[3]}`);

    await page.evaluate(`document.getElementById('dtprev').click()`);
    check("#324 the target arrow moves the TARGET and leaves the base alone",
        await page.evaluate<string | null>(markedEvent("diff-base")) === names[1]
        && await page.evaluate<string | null>(markedEvent("diff-target")) === names[2]);

    check("#324 an arrow whose step would collide with the other end is DISABLED",
        await page.evaluate<boolean>(`document.getElementById('dbnext').disabled
            && document.getElementById('dtprev').disabled`));

    // Walk the base to the top of the lane; its "previous" arrow must then stop, not wrap.
    await page.evaluate(`document.getElementById('dbprev').click()`);
    check("#324 an arrow at the lane's end STOPS rather than wrapping round",
        await page.evaluate<string | null>(markedEvent("diff-base")) === names[0]
        && await page.evaluate<boolean>(`document.getElementById('dbprev').disabled`));
}

// ---- tasks #319/#320: what row 2 does ------------------------------------------------------------
export async function checkDiffTools(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string | null>(RICH_PATH);
    if (path === null) {
        return;
    }
    await page.evaluate(clickNode(path, 0));
    await page.evaluate(clickNode(path, 3, true));
    check("#319 the pair opens side-by-side, in two columns",
        await page.evaluate<number>(`document.querySelectorAll('#dbody .diff-cols').length`) === 1
        && await page.evaluate<boolean>(
            `document.querySelector('#difftools [data-mode="side"]').classList.contains('current')`));
    const columnRows = await page.evaluate<number>(bodyRows);
    check("#319 the two revisions actually differ, so there is a diff to look at",
        await page.evaluate<number>(`document.querySelectorAll('#dbody .d-add, #dbody .d-del').length`) > 0);

    await page.evaluate(`document.querySelector('#difftools [data-mode="inline"]').click()`);
    check("#319 inline is ONE column and paints the current button",
        await page.evaluate<number>(`document.querySelectorAll('#dbody .diff-inline').length`) === 1
        && await page.evaluate<number>(`document.querySelectorAll('#dbody .diff-cols').length`) === 0
        && await page.evaluate<boolean>(
            `document.querySelector('#difftools [data-mode="inline"]').classList.contains('current')`));

    const narrow = await page.evaluate<number>(bodyRows);
    await page.evaluate(`(() => { const f = document.getElementById('dfull');
        f.checked = true; f.dispatchEvent(new Event('change')); })()`);
    check("#320 'full content' WIDENS the same diff rather than replacing it",
        await page.evaluate<number>(bodyRows) > narrow
        && await page.evaluate<number>(`document.querySelectorAll('#dbody .diff-inline').length`) === 1,
        { narrow, full: await page.evaluate<number>(bodyRows) });
    check("#320 the toggle is a checkbox and reads back as checked",
        await page.evaluate<boolean>(`document.getElementById('dfull').checked`));

    // Back to the state the rest of the run expects.
    await page.evaluate(`(() => { const f = document.getElementById('dfull');
        f.checked = false; f.dispatchEvent(new Event('change')); })()`);
    await page.evaluate(`document.querySelector('#difftools [data-mode="side"]').click()`);
    check("#319 turning full content off restores the windowed diff",
        await page.evaluate<number>(bodyRows) === columnRows);
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
    const before = await page.evaluate<string>(textOf("dpairlabel"));
    await page.evaluate(clickNode(other, 0, true));
    check("#305 a shift-click on another bubble is refused VISIBLY",
        await page.evaluate<boolean>(`!document.getElementById('dtoast').hidden`)
        && (await page.evaluate<string>(textOf("dtoast"))).includes("ONE bubble"));
    check("#305 the refused click leaves the shown pair exactly as it was",
        await page.evaluate<string>(textOf("dpairlabel")) === before);
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
        [...document.querySelectorAll('#nav .file-item')]
            .find(i => i.title === want || i.title === want + ' (deleted)').click();
    })()`);
    check("#325 a File Nav click OPENS the Detail view",
        await page.evaluate<boolean>(`document.getElementById('drawer').classList.contains('open')`));
    check("#325 it shows the file's ON-DISK state",
        (await page.evaluate<string>(textOf("dpath"))).includes("Current on-disk state"),
        await page.evaluate<string>(textOf("dpath")));
    check("#325 the on-disk node is the one selected",
        await page.evaluate<boolean>(`(() => {
            const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
            return box.querySelector('.node.n-disk:not(.n-created)').classList.contains('found');
        })()`));
    check("#325 the inert created-at node is NOT what got selected",
        await page.evaluate<boolean>(`(() => {
            const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
            return !box.querySelector('.node.n-created').classList.contains('found');
        })()`));
    check("#325 clicking the nav DESELECTS whatever was selected before",
        await page.evaluate<number>(`document.querySelectorAll('.node.found').length`) === 1);
}

// ---- task #326 -----------------------------------------------------------------------------------
const bubbleCount = `document.querySelectorAll('.filebox:not(.bucket)').length`;
const clickFirstFolder = `(() => {
    const folder = document.querySelector('#nav .file-folder-name');
    folder.click();
    return folder.textContent;
})()`;

export async function checkShowOnlySelected(page: HeadlessPage): Promise<void> {
    await page.evaluate(`document.getElementById('dclose').click()`);
    const all = await page.evaluate<number>(bubbleCount);
    const folder = await page.evaluate<string | null>(clickFirstFolder);
    check("#326 the fixture nests its files, so there is a folder to select", folder !== null);
    check("#326 a folder click alone does NOT filter the timeline",
        await page.evaluate<number>(bubbleCount) === all, { all, folder });

    await page.evaluate(`document.getElementById('only-selected').click()`);
    const filtered = await page.evaluate<number>(bubbleCount);
    check("#326 the toggle narrows the timeline to the selected folder", filtered > 0 && filtered < all,
        { all, filtered });
    check("#326 every surviving bubble is inside the selected folder",
        await page.evaluate<boolean>(`[...document.querySelectorAll('.filebox:not(.bucket)')]
            .every(b => b.dataset.path.startsWith(${JSON.stringify(folder)} + '/'))`));
    check("#326 the toggle paints itself as active",
        await page.evaluate<boolean>(
            `document.getElementById('only-selected').classList.contains('current')`));

    await page.evaluate(`document.getElementById('only-selected').click()`);
    check("#326 turning it off restores every file", await page.evaluate<number>(bubbleCount) === all);

    // On with NOTHING selected must also show everything — the empty selection is not "hide all".
    await page.evaluate(`document.getElementById('clear-filter').click()`);
    await page.evaluate(`document.getElementById('only-selected').click()`);
    check("#326 on with an empty selection shows every file",
        await page.evaluate<number>(bubbleCount) === all);
    // Leave the page as the rest of the run expects it.
    await page.evaluate(`document.getElementById('only-selected').click()`);
}

// ---- File Nav bugs reported 2026-07-29 -----------------------------------------------------------
export async function checkNavBugs(page: HeadlessPage): Promise<void> {
    // A deleted file has no bubble, so the clicked ROW is the only answer a click can give.
    const deleted = await page.evaluate<string | null>(
        `document.querySelector('#nav .file-item.deleted')?.title?.replace(' (deleted)', '') ?? null`);
    check("the fixture lists a deleted file", deleted !== null);
    if (deleted !== null) {
        await page.evaluate(`document.querySelector('#nav .file-item.deleted').click()`);
        check("clicking a DELETED file marks its File Nav row as selected",
            await page.evaluate<boolean>(
                `document.querySelector('#nav .file-item.deleted').classList.contains('selected')`));
    }
    await page.evaluate(`[...document.querySelectorAll('#nav .file-item')].find(i => !i.classList.contains('deleted')).click()`);
    check("selecting another row clears the previous one — one nav selection at a time",
        await page.evaluate<number>(`document.querySelectorAll('#nav .file-item.selected').length`) === 1);

    // The triangle must COLLAPSE the folder; the name beside it must still filter instead.
    const openBefore = await page.evaluate<boolean>(
        `document.querySelector('#nav .file-folder').open`);
    await page.evaluate(`document.querySelector('#nav .file-folder > summary > .file-folder-toggle').click()`);
    check("the folder triangle actually collapses the folder",
        openBefore && await page.evaluate<boolean>(`!document.querySelector('#nav .file-folder').open`));
    await page.evaluate(`document.querySelector('#nav .file-folder > summary > .file-folder-toggle').click()`);
    check("the triangle expands it again",
        await page.evaluate<boolean>(`document.querySelector('#nav .file-folder').open`));
    check("clicking the triangle does NOT select the folder",
        await page.evaluate<number>(`document.querySelectorAll('#nav .file-folder-name.selected').length`) === 0);

    // The header must not scroll away with the tree.
    check("the Files pane header is sticky, so its buttons survive a scroll",
        await page.evaluate<string>(
            `getComputedStyle(document.querySelector('#pane-files .panehead')).position`) === "sticky");
    const headTop = await page.evaluate<number>(`(() => {
        const pane = document.getElementById('pane-files');
        pane.scrollTop = 400;
        const head = pane.querySelector('.panehead').getBoundingClientRect();
        return Math.round(head.top - pane.getBoundingClientRect().top);
    })()`);
    check("scrolling the tree leaves the header pinned at the pane's top", headTop <= 1, { headTop });
    await page.evaluate(`document.getElementById('pane-files').scrollTop = 0`);
}
