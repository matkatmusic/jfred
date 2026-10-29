// Tasks #328/#329 — multi-selection fills the drawer with one diff container per file, alphabetical.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

// Task 326's gesture: shift toggles a leaf into the selection without clearing the others.
const buildShiftClickLeafScript = (path: string) => `[...document.querySelectorAll('#filenav-tree .file-item')]
    .find(i => i.dataset.target === ${JSON.stringify(path)})
    .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`;

// A plain click on a folder NAME (not its toggle) selects the whole subtree.
const buildClickFolderNameScript = (name: string) => `[...document.querySelectorAll('#filenav-tree .file-folder-name')]
    .find(s => s.textContent === ${JSON.stringify(name)}).click()`;

const SECTION_PATHS =
  `[...document.querySelectorAll('#dbody details.dfile .dfile-path')].map(s => s.dataset.target)`;

const buildSectionScript = (path: string) => `[...document.querySelectorAll('#dbody details.dfile')]
    .find(d => d.querySelector('.dfile-path').dataset.target === ${JSON.stringify(path)})`;

// Sections fetch their diffs async; a body is settled once diff rows or the no-difference note land.
const buildBodySettledScript = (path: string) =>
  `${buildSectionScript(path)}.querySelectorAll('.dfile-body .diff-line, .dfile-body .dbinary').length > 0`;

export async function validateMultiFileDrawer(page: HeadlessPage): Promise<void> {
  // Earlier checks leave one plain-clicked row selected; shift-toggle it off so counts start clean.
  await page.evaluate(`[...document.querySelectorAll('#filenav-tree .file-item.selected')]
        .forEach(i => i.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))`);
  // Two committed (steppable), present leaves; the fixture's pairs guarantee at least two.
  const [a, b] = await page.evaluate<[string, string]>(
    `[...document.querySelectorAll('#filenav-tree .file-item:not(.deleted)')]
        .filter(i => !(i.querySelector('.revcount')?.textContent ?? '(0)').includes('(0)'))
        .slice(0, 2).map(i => i.dataset.target)`);
  await page.evaluate(buildShiftClickLeafScript(a));
  await page.evaluate(buildShiftClickLeafScript(b));
  const pair = await page.evaluate<string[]>(SECTION_PATHS);
  reportCheck("#328 shift-clicking two leaves opens one section per file, alphabetical",
    await page.evaluate<boolean>(`document.getElementById('drawer').classList.contains('open')`)
        && JSON.stringify(pair) === JSON.stringify([a, b].sort()), { pair, a, b });

  // #dbody is a row flex for the single-file gutter+code; sections must opt out and stack.
  reportCheck("#328 sections stack vertically, never side by side",
    await page.evaluate<boolean>(`(() => {
        const [first, second] = document.querySelectorAll('#dbody details.dfile');
        return second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom;
    })()`));

  // Defaults: the single-pair header shape — on disk vs on disk, inline mode, full content on.
  await page.waitFor(buildBodySettledScript(a), 10_000);
  reportCheck("#328 a section is the single-pair pane defaulting to on disk / inline / full content",
    await page.evaluate<boolean>(`(() => {
        const d = ${buildSectionScript(a)};
        // Task 386: equal sides collapse the label to one revision and leave the meta line empty (#329).
        return d.querySelector('.dpair').textContent === 'on disk'
            && d.querySelectorAll('summary .dtools button').length === 4
            && d.querySelector('button[data-mode="inline"]').classList.contains('current')
            && d.querySelector('.dfull-toggle input').checked
            && d.querySelector('.dmeta').textContent === '';
    })()`));

  // The pane cap: a section's body never grows past its max-height; long files scroll inside it.
  reportCheck("#328 a section's body is height-capped with its own scrollbar",
    await page.evaluate<boolean>(`(() => {
        const style = getComputedStyle(${buildSectionScript(a)}.querySelector('.dfile-body'));
        return style.maxHeight.endsWith('px') && style.overflowY === 'auto';
    })()`));

  // Stepping base ↑ (older) re-labels the pair and re-renders that section's diff.
  reportCheck("#328 stepping the base arrow shows a two-sided pair label",
    await page.evaluate<boolean>(`(() => {
        const arrows = [...${buildSectionScript(a)}.querySelectorAll('summary .dtools button')];
        if (arrows[0].disabled) return false;
        arrows[0].click();
        return ${buildSectionScript(a)}.querySelector('.dpair').textContent.endsWith(' - on disk')
            && !${buildSectionScript(a)}.querySelector('.dpair').textContent.startsWith('on disk');
    })()`));
  await page.waitFor(buildBodySettledScript(a), 10_000);
  // ↓ steps back to on disk, restoring the equal-sides default for the checks that follow.
  await page.evaluate(`[...${buildSectionScript(a)}.querySelectorAll('summary .dtools button')][1].click()`);
  await page.waitFor(buildBodySettledScript(a), 10_000);

  // The drawer-header pair drives every section at once.
  reportCheck("#328 the one fold button closes every section, then reopens them",
    await page.evaluate<boolean>(`(() => {
        const button = document.getElementById('dfold-all');
        const sections = [...document.querySelectorAll('#dbody details.dfile')];
        button.click();
        const closed = sections.every(d => !d.open) && button.textContent === 'Show all';
        button.click();
        return closed && sections.every(d => d.open) && button.textContent === 'Collapse all';
    })()`));

  // A hand toggle fires `toggle` asynchronously, so each step waits for the label.
  await page.evaluate(`document.querySelectorAll('#dbody details.dfile')[0].open = false`);
  await page.waitFor(`document.getElementById('dfold-all').textContent === 'Collapse all'`, 5_000);
  reportCheck("#328 closing one section by hand while another is open keeps Collapse all",
    await page.evaluate<boolean>(`document.getElementById('dfold-all').textContent === 'Collapse all'`));
  await page.evaluate(`[...document.querySelectorAll('#dbody details.dfile')].forEach(d => { d.open = false; })`);
  await page.waitFor(`document.getElementById('dfold-all').textContent === 'Show all'`, 5_000);
  reportCheck("#328 closing every section by hand shows Show all",
    await page.evaluate<boolean>(`document.getElementById('dfold-all').textContent === 'Show all'`));
  await page.evaluate(`document.getElementById('dfold-all').click()`);

  // The collapse mechanism is the native <details>: closing one hides its body, no JS.
  reportCheck("#328 a section collapses when its <details> closes", await page.evaluate<boolean>(`(() => {
        const d = document.querySelector('#dbody details.dfile');
        d.open = false;
        // Task 386: a closed <details> keeps its body's offsetHeight in current Chrome; checkVisibility() reports it hidden.
        const hidden = !d.querySelector('.dfile-body').checkVisibility();
        d.open = true;
        return hidden;
    })()`));

  // Restore the leaf selection, then: a folder click shows every file in its subtree.
  await page.evaluate(buildShiftClickLeafScript(a));
  await page.evaluate(buildShiftClickLeafScript(b));
  const folder = await page.evaluate<string>(`[...document.querySelectorAll('#filenav-tree details.file-folder')]
        .find(d => d.querySelectorAll('.file-item').length >= 2)
        .querySelector('.file-folder-name').textContent`);
  const expected = await page.evaluate<string[]>(`[...[...document.querySelectorAll('#filenav-tree details.file-folder')]
        .find(d => d.querySelector('.file-folder-name').textContent === ${JSON.stringify(folder)})
        .querySelectorAll('.file-item')].map(i => i.dataset.target).sort()`);
  await page.evaluate(buildClickFolderNameScript(folder));
  reportCheck("#328 a folder click renders one section per descendant file",
    JSON.stringify(await page.evaluate<string[]>(SECTION_PATHS)) === JSON.stringify(expected),
    { folder, expected });
  // A second plain click on the only-selected folder clears it (#254), restoring the nav state.
  await page.evaluate(buildClickFolderNameScript(folder));
  // The multi-selections auto-armed Show Only Selected (task 326); disarm so the stage round-trips.
  await page.evaluate(`(() => {
        const toggle = document.getElementById('filenav-only-selected');
        if (toggle.classList.contains('current')) toggle.click();
    })()`);
}
