// Tasks #305/#325/#326 + #329: cross-bubble shift-click, the nav's on-disk click, Show Only, File Nav bugs.

import { type HeadlessPage } from "./cdp.ts";
import { BUBBLES, buildBubbleSelector, reportCheck } from "./mockup-checks.ts";
import { PANE_SETTLED, RICH_PATH, triggerNodeClick } from "./mockup-diff-pane.ts";

// A shift-click on a DIFFERENT bubble is refused out loud (#305), and the shown pair is untouched.
export async function validateCrossBubbleRefusal(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string | null>(RICH_PATH);
  const other = await page.evaluate<string | null>(`(() => {
        const box = [...document.querySelectorAll('${BUBBLES}')]
            .find(b => b.querySelector('.fname').dataset.path !== ${JSON.stringify(path)} && b.querySelector('.node:not(.n-created)'));
        return box?.querySelector('.fname').dataset.path ?? null;
    })()`);
  const hasPath = path !== null;
  const hasOther = other !== null;
  const hasBothBubbles = hasPath && hasOther;
  if (!hasBothBubbles) {
    return;
  }
  await page.evaluate(triggerNodeClick(path, 0));
  await page.evaluate(triggerNodeClick(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  await page.evaluate(triggerNodeClick(other, 0, true));
  // Task 386: #329 made the range global (instants, not one bubble), so another bubble's shift-click extends it, never refuses.
  reportCheck("#329 a shift-click on another bubble extends the range, with no refusal toast",
    await page.evaluate<boolean>(`document.getElementById('dtoast').hidden`)
        && (await page.evaluate<string>(`document.getElementById('dpath').textContent`)).endsWith("range diff"));
  reportCheck("#329 the extended range still marks exactly one base and one target on the lane",
    await page.evaluate<number>(`document.querySelectorAll('.diff-base, .diff-target').length`) === 2);
}

// ---- task #325 -----------------------------------------------------------------------------------
export async function validateNavOpensDiskNode(page: HeadlessPage): Promise<void> {
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
  // Task 386: #329 nav click lands on the file's bubble, shows its on-disk pane, selects no lane node.
  await page.waitFor(`document.querySelector('${buildBubbleSelector(path)}').classList.contains('found')`, 10_000);
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

export async function validateShowOnlySelected(page: HeadlessPage): Promise<void> {
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
export async function validateNavBugs(page: HeadlessPage): Promise<void> {
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
