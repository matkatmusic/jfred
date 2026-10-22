// Tasks #324/#325/#326 + #329: the DiffView pane's pair behaviours, the nav's on-disk click, Show Only.

// Its own file because mockup-checks.ts is at the 250-line cap; run order lives in mockup.ts.

import { type HeadlessPage } from "./cdp.ts";
import { BUBBLES, bubbleOf, reportCheck } from "./mockup-checks.ts";

// A bubble with at least four clickable nodes, so a pair has somewhere to step to between its ends.
const RICH_PATH = `(() => {
    const box = [...document.querySelectorAll('${BUBBLES}')]
        .find(b => b.querySelectorAll('.node:not(.n-created)').length >= 4);
    return box?.querySelector('.fname').dataset.path ?? null;
})()`;

// A bubble's clickable nodes in axis order: DOM order is ladder order, not time order.
const nodesOf = (path: string) => `[...document.querySelector('${bubbleOf(path)}').querySelectorAll('.node:not(.n-created)')]
    .sort((a, b) => Number(a.style.getPropertyValue('--axis-px')) - Number(b.style.getPropertyValue('--axis-px')))`;

// The marker vocabulary a pane speaks for a lane node (layer1-revision-sources.ts).
const MARKER_OF = `(dot => dot.classList.contains('n-commit') && dot.title ? dot.title.slice(0, 8)
    : dot.classList.contains('n-snap') ? '@v' + dot.dataset.version + ' 📸' : 'on disk')`;

// Clicks the Nth clickable node of a bubble; `shift` extends a selection into a pair (#305).
const clickNode = (path: string, index: number, shift = false) => `(() => {
    const dot = ${nodesOf(path)}[${index}];
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }));
    return ${MARKER_OF}(dot);
})()`;

const PANE = `[...document.querySelectorAll('#dbody details.dfile')].find(d => (d.querySelector('.dfile-path')?.dataset.target ?? ${RICH_PATH}) === ${RICH_PATH})`;
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
  reportCheck("#324 the fixture has a bubble with enough nodes to step a pair through", path !== null);
  if (path === null) {
    return;
  }
  // A plain click is the SINGLE-revision pane: controls hidden, node-step arrows shown.
  await page.evaluate(clickNode(path, 0));
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#329 a single-node click shows a pane with hidden revision controls",
    await page.evaluate<boolean>(`${paneArrow(0)}.hidden && !document.getElementById('dprev').hidden`));

  const baseName = await page.evaluate<string>(clickNode(path, 0));
  const targetName = await page.evaluate<string>(clickNode(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#324 shift-click opens the pair pane: its arrows appear and the single arrows go away",
    await page.evaluate<boolean>(`!${paneArrow(0)}.hidden && document.getElementById('dprev').hidden`));
  reportCheck("#324 the pane label reads '<base> - <target>'",
    await page.evaluate<string>(PANE_LABEL) === `${baseName} - ${targetName}`,
    { baseName, targetName, shown: await page.evaluate<string>(PANE_LABEL) });
  reportCheck("#324 the lane marks the two ends as base and target",
    await page.evaluate<string | null>(ringMarker("diff-base")) === baseName
        && await page.evaluate<string | null>(ringMarker("diff-target")) === targetName);
  reportCheck("#324 the pair's marks REPLACE the single selection's [ ] brackets",
    await page.evaluate<number>(`document.querySelectorAll('.node.found').length`) === 0);

  // Direction comes from axis position, never click order: clicking upwards must match downwards.
  await page.evaluate(clickNode(path, 3));
  await page.evaluate(clickNode(path, 0, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#324 the pair's direction comes from the axis, not the click order",
    await page.evaluate<string | null>(ringMarker("diff-base")) === baseName
        && await page.evaluate<string | null>(ringMarker("diff-target")) === targetName);
}

// ---- task #324's four arrows, now pane-owned ----------------------------------------------------
export async function checkPairArrows(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string | null>(RICH_PATH);
  if (path === null) {
    return;
  }
  const names = await page.evaluate<string[]>(`${nodesOf(path)}.map(${MARKER_OF})`);
  await page.evaluate(clickNode(path, 0));
  await page.evaluate(clickNode(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);

  await page.evaluate(`${paneArrow(1)}.click()`);
  await page.waitFor(PANE_SETTLED, 10_000);
  // Task 386: a pane's arrows step only that section (onSidesChanged is unwired), so the label is the oracle, not the lane ring.
  reportCheck("#324 the base arrow moves the BASE and leaves the target alone",
    await page.evaluate<string>(PANE_LABEL) === `${names[1]} - ${names[3]}`);
  reportCheck("#324 the pane's meta line follows the moved base",
    await page.evaluate<string>(`${PANE}.querySelector('.dmeta').textContent`) === `base ${names[1]} → target ${names[3]}`);

  await page.evaluate(`${paneArrow(2)}.click()`);
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#324 the target arrow moves the TARGET and leaves the base alone",
    await page.evaluate<string>(PANE_LABEL) === `${names[1]} - ${names[2]}`);

  // Task 329: stepping ONTO the other side is allowed — equal sides read as one revision.
  await page.evaluate(`${paneArrow(1)}.click()`);
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#329 equal sides collapse the label to the one revision",
    await page.evaluate<string>(PANE_LABEL) === names[2]);

  // Walk the base back to the top of the lane; its "previous" arrow must then stop, not wrap.
  await page.evaluate(`${paneArrow(0)}.click()`);
  await page.evaluate(`${paneArrow(0)}.click()`);
  await page.waitFor(`${paneArrow(0)}.disabled`, 10_000);
  reportCheck("#324 an arrow at the lane's end STOPS rather than wrapping round",
    await page.evaluate<string>(PANE_LABEL) === `${names[0]} - ${names[2]}`
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
  // Task 386: #328 made every pane open INLINE, so the old "opens side-by-side" check now asserts the inline default.
  reportCheck("#319 the pair opens inline, in one column",
    await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 0
        && await page.evaluate<boolean>(
          `${PANE}.querySelector('button[data-mode="inline"]').classList.contains('current')`));
  reportCheck("#319 the two revisions actually differ, so there is a diff to look at",
    await page.evaluate<number>(
      `${PANE}.querySelectorAll('.dfile-body .diff-line.add, .dfile-body .diff-line.del').length`) > 0);

  await page.evaluate(`${PANE}.querySelector('button[data-mode="inline"]').click()`);
  reportCheck("#319 inline is ONE column and paints the current button",
    await page.evaluate<number>(INLINE_ROWS) > 0
        && await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 0
        && await page.evaluate<boolean>(
          `${PANE}.querySelector('button[data-mode="inline"]').classList.contains('current')`));

  const narrow = await page.evaluate<number>(INLINE_ROWS);
  await page.evaluate(`(() => { const f = ${PANE}.querySelector('.dfull-toggle input');
        f.checked = true; f.dispatchEvent(new Event('change')); })()`);
  await page.waitFor(`${INLINE_ROWS} > ${narrow}`, 10_000);
  reportCheck("#320 'full content' WIDENS the same diff rather than replacing it",
    await page.evaluate<number>(INLINE_ROWS) > narrow, { narrow });

  // Back to the state the rest of the run expects.
  await page.evaluate(`(() => { const f = ${PANE}.querySelector('.dfull-toggle input');
        f.checked = false; f.dispatchEvent(new Event('change')); })()`);
  await page.waitFor(`${INLINE_ROWS} === ${narrow}`, 10_000);
  await page.evaluate(`${PANE}.querySelector('button[data-mode="side"]').click()`);
  reportCheck("#319 turning full content off restores the windowed diff",
    await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 1);
}

// A shift-click on a DIFFERENT bubble is refused out loud (#305), and the shown pair is untouched.
export async function checkCrossBubbleRefusal(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string | null>(RICH_PATH);
  const other = await page.evaluate<string | null>(`(() => {
        const box = [...document.querySelectorAll('${BUBBLES}')]
            .find(b => b.querySelector('.fname').dataset.path !== ${JSON.stringify(path)} && b.querySelector('.node:not(.n-created)'));
        return box?.querySelector('.fname').dataset.path ?? null;
    })()`);
  if (path === null || other === null) {
    return;
  }
  await page.evaluate(clickNode(path, 0));
  await page.evaluate(clickNode(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  await page.evaluate(clickNode(other, 0, true));
  // Task 386: #329 made the range global (instants, not one bubble), so another bubble's shift-click extends it, never refuses.
  reportCheck("#329 a shift-click on another bubble extends the range, with no refusal toast",
    await page.evaluate<boolean>(`document.getElementById('dtoast').hidden`)
        && (await page.evaluate<string>(`document.getElementById('dpath').textContent`)).endsWith("range diff"));
  reportCheck("#329 the extended range still marks exactly one base and one target on the lane",
    await page.evaluate<number>(`document.querySelectorAll('.diff-base, .diff-target').length`) === 2);
}

// ---- task #325 -----------------------------------------------------------------------------------
export async function checkNavOpensDiskNode(page: HeadlessPage): Promise<void> {
  // The trap case: created-at also carries `.n-disk`, sorts first, and is inert.
  const path = await page.evaluate<string | null>(`(() => {
        const box = [...document.querySelectorAll('${BUBBLES}')]
            .find(b => b.querySelector('.node.n-created'));
        return box?.querySelector('.fname').dataset.path ?? null;
    })()`);
  reportCheck("#325 the fixture has a file with a created-at node to test against", path !== null);
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
  reportCheck("#325 it shows the file's ON-DISK state",
    (await page.evaluate<string>(`document.getElementById('dpath').textContent`)).includes("Current on-disk state"));
  // Task 386: #329 made a nav click land on the file's bubble and show its on-disk pane, with no lane node selected.
  await page.waitFor(`document.querySelector('${bubbleOf(path)}').classList.contains('found')`, 10_000);
  reportCheck("#325 the nav click lights the file's bubble and selects no lane node, never the inert created-at",
    await page.evaluate<boolean>(`document.querySelectorAll('.node.found').length === 0`));
}

// ---- task #326 -----------------------------------------------------------------------------------
const bubbleCount = `document.querySelectorAll('${BUBBLES}').length`;
const clickFirstFolder = `(() => {
    const folder = document.querySelector('#filenav-tree .file-folder-name');
    folder.click();
    return folder.textContent;
})()`;

export async function checkShowOnlySelected(page: HeadlessPage): Promise<void> {
  await page.evaluate(`document.getElementById('dclose').click()`);
  const all = await page.evaluate<number>(bubbleCount);
  const folder = await page.evaluate<string | null>(clickFirstFolder);
  reportCheck("#326 the fixture nests its files, so there is a folder to select", folder !== null);

  await page.evaluate(`document.getElementById('filenav-only-selected').click()`);
  await page.waitFor(`${bubbleCount} < ${all}`, 10_000);
  const filtered = await page.evaluate<number>(bubbleCount);
  reportCheck("#326 the toggle narrows the timeline to the selected folder", filtered > 0 && filtered < all,
    { all, filtered });
  reportCheck("#326 the toggle paints itself as active",
    await page.evaluate<boolean>(
      `document.getElementById('filenav-only-selected').classList.contains('current')`));

  await page.evaluate(`document.getElementById('filenav-only-selected').click()`);
  await page.waitFor(`${bubbleCount} === ${all}`, 10_000);
  reportCheck("#326 turning it off restores every file", await page.evaluate<number>(bubbleCount) === all);
  // Clear the folder selection (a plain click on the selected folder clears it, #254's rule).
  await page.evaluate(clickFirstFolder);
}

// ---- File Nav bugs reported 2026-07-29 -----------------------------------------------------------
export async function checkNavBugs(page: HeadlessPage): Promise<void> {
  // A deleted file has no bubble, so the clicked ROW is the only answer a click can give.
  const deleted = await page.evaluate<string | null>(
    `document.querySelector('#filenav-tree .file-item.deleted')?.title?.replace(' (deleted)', '') ?? null`);
  reportCheck("the fixture lists a deleted file", deleted !== null);
  if (deleted !== null) {
    await page.evaluate(`document.querySelector('#filenav-tree .file-item.deleted').click()`);
    reportCheck("clicking a DELETED file marks its File Nav row as selected",
      await page.evaluate<boolean>(
        `document.querySelector('#filenav-tree .file-item.deleted').classList.contains('selected')`));
  }
  await page.evaluate(
    `[...document.querySelectorAll('#filenav-tree .file-item')].find(i => !i.classList.contains('deleted')).click()`);
  reportCheck("selecting another row clears the previous one — one nav selection at a time",
    await page.evaluate<number>(`document.querySelectorAll('#filenav-tree .file-item.selected').length`) === 1);

  // The triangle must COLLAPSE the folder; the name beside it must still filter instead.
  const openBefore = await page.evaluate<boolean>(
    `document.querySelector('#filenav-tree .file-folder').open`);
  await page.evaluate(`document.querySelector('#filenav-tree .file-folder > summary > .file-folder-toggle').click()`);
  reportCheck("the folder triangle actually collapses the folder",
    openBefore && await page.evaluate<boolean>(`!document.querySelector('#filenav-tree .file-folder').open`));
  await page.evaluate(`document.querySelector('#filenav-tree .file-folder > summary > .file-folder-toggle').click()`);
  reportCheck("the triangle expands it again",
    await page.evaluate<boolean>(`document.querySelector('#filenav-tree .file-folder').open`));
  reportCheck("clicking the triangle does NOT select the folder",
    await page.evaluate<number>(
      `document.querySelectorAll('#filenav-tree .file-folder-name.selected').length`) === 0);
}
