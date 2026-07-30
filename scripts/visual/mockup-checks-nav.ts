// Tasks #308/#309/#328 — File Nav pane checks; separate file because mockup-checks.ts is at cap.

import { type HeadlessPage } from "./cdp.ts";
import { check } from "./mockup-checks.ts";

// The bubble the most sessions touched, so a point-sensitive lead has somewhere to move to.
const BUSIEST_PATH = `(() => {
    const touch = p => window.__fixture.SESSIONS.filter(s => s.paths.includes(p)).length;
    return [...document.querySelectorAll('.filebox[data-path]')]
        .map(b => b.dataset.path).sort((a, b) => touch(b) - touch(a))[0];
})()`;

// Clicks the box beside a node (never the node itself), so it lands as a bubble click.
const clickBesideNode = (path: string, which: "0" | "-1") => `(() => {
    const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
    const node = [...box.querySelectorAll('.node')].at(${which}).getBoundingClientRect();
    box.dispatchEvent(new MouseEvent('click', { bubbles: true,
        clientX: box.getBoundingClientRect().left + 4, clientY: node.top + node.height / 2 }));
    return [...document.querySelectorAll('.session-item.flash')].map(i => i.dataset.file);
})()`;

const LEAD = `document.querySelector('.session-item.flash-lead')?.dataset.file ?? null`;

// The session the page SHOULD lead with for a click level with this bubble's first (or last) node: the window nearest that node's own instant, which is the answer the page's ruler lookup owes.
const expectedLead = (path: string, which: "0" | "-1") => `(() => {
    const rows = [...document.querySelectorAll('.filebox[data-path=${JSON.stringify(path)}] .node')];
    const t = Number(rows.at(${which}).dataset.instant);
    const gap = s => Math.max(0, Date.parse(s.started) - t, t - Date.parse(s.ended));
    return window.__fixture.SESSIONS.filter(s => s.paths.includes(${JSON.stringify(path)}))
        .sort((a, b) => gap(a) - gap(b))[0].file;
})()`;

export async function checkBubbleFlash(page: HeadlessPage): Promise<void> {
    const path = await page.evaluate<string>(BUSIEST_PATH);
    const expected = await page.evaluate<string[]>(
        `window.__fixture.SESSIONS.filter(s => s.paths.includes(${JSON.stringify(path)})).map(s => s.file)`);
    const flashed = await page.evaluate<string[]>(clickBesideNode(path, "0"));
    check("#308 a bubble click flashes every JSONL that touched that file",
        JSON.stringify([...flashed].sort()) === JSON.stringify([...expected].sort()), { flashed, expected });
    check("#308 highlighting is not selecting — no session is filtered by the click",
        await page.evaluate<number>(`document.querySelectorAll('.session-item.selected').length`) === 0);
    const leadTop = await page.evaluate<string | null>(LEAD);
    check("#308 a click at the TOP of the bubble leads with the session nearest THAT instant",
        leadTop === await page.evaluate<string>(expectedLead(path, "0")), { path, leadTop });
    await page.evaluate(clickBesideNode(path, "-1"));
    const leadBottom = await page.evaluate<string | null>(LEAD);
    check("#308 a click at the BOTTOM leads with the session nearest the LAST node's instant",
        leadBottom === await page.evaluate<string>(expectedLead(path, "-1")), { path, leadBottom });
}

const typeSearch = (text: string) => `(() => {
    const box = document.getElementById('session-search');
    box.value = ${JSON.stringify(text)};
    box.dispatchEvent(new Event('input'));
    return [...document.querySelectorAll('.session-item')].map(i => i.dataset.file);
})()`;

export async function checkSessionSearch(page: HeadlessPage): Promise<void> {
    const bubblesBefore = await page.evaluate<number>(`document.querySelectorAll('.filebox').length`);
    const all = await page.evaluate<number>(`window.__fixture.SESSIONS.length`);
    const term = await page.evaluate<string>(
        `window.__fixture.SESSIONS.flatMap(s => s.titles).map(t => t.title)[0].split(' ')[0]`);
    const expected = await page.evaluate<string[]>(`window.__fixture.SESSIONS.filter(s =>
        [...new Set(s.titles.map(t => t.title))]
            .some(t => t.toLowerCase().includes(${JSON.stringify(term)}.toLowerCase()))).map(s => s.file)`);
    const shown = await page.evaluate<string[]>(typeSearch(term));
    check("#309 the box filters the JSONL list by customTitle",
        JSON.stringify(shown) === JSON.stringify(expected), { term, shown, expected });
    check("#309 an unnamed session is gone while the box has text",
        !shown.includes("7ce50a19.jsonl"), shown);
    check("#309 filtering the LIST does not filter the TIMELINE",
        await page.evaluate<number>(`document.querySelectorAll('.filebox').length`) === bubblesBefore);
    check("#309 a term nothing matches empties the list and says so",
        (await page.evaluate<string[]>(typeSearch("zzz-no-such-title"))).length === 0
        && await page.evaluate<number>(`document.querySelectorAll('#sessions .navempty').length`) === 1);
    await page.evaluate(`document.getElementById('session-search-clear').click()`);
    check("#309 the clear button restores every session",
        await page.evaluate<number>(`document.querySelectorAll('.session-item').length`) === all);
}

// Tasks #328/#329 — multi-selection fills the drawer with one diff container per file, alphabetical.

// Task 326's gesture: shift toggles a leaf into the selection without clearing the others.
const shiftClickLeaf = (path: string) => `[...document.querySelectorAll('#filenav-tree .file-item')]
    .find(i => i.dataset.target === ${JSON.stringify(path)})
    .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`;

// A plain click on a folder NAME (not its toggle) selects the whole subtree.
const clickFolderName = (name: string) => `[...document.querySelectorAll('#filenav-tree .file-folder-name')]
    .find(s => s.textContent === ${JSON.stringify(name)}).click()`;

const SECTION_PATHS =
    `[...document.querySelectorAll('#dbody details.dfile .dfile-path')].map(s => s.dataset.target)`;

const sectionFor = (path: string) => `[...document.querySelectorAll('#dbody details.dfile')]
    .find(d => d.querySelector('.dfile-path').dataset.target === ${JSON.stringify(path)})`;

// Sections fetch their diffs async; a body is settled once diff rows or the no-difference note land.
const bodySettled = (path: string) =>
    `${sectionFor(path)}.querySelectorAll('.dfile-body .diff-line, .dfile-body .dbinary').length > 0`;

export async function checkMultiFileDrawer(page: HeadlessPage): Promise<void> {
    // Earlier checks leave one plain-clicked row selected; shift-toggle it off so counts start clean.
    await page.evaluate(`[...document.querySelectorAll('#filenav-tree .file-item.selected')]
        .forEach(i => i.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))`);
    // Two committed (steppable), present leaves; the fixture's pairs guarantee at least two.
    const [a, b] = await page.evaluate<[string, string]>(
        `[...document.querySelectorAll('#filenav-tree .file-item:not(.deleted)')]
        .filter(i => !(i.querySelector('.revcount')?.textContent ?? '(0)').includes('(0)'))
        .slice(0, 2).map(i => i.dataset.target)`);
    await page.evaluate(shiftClickLeaf(a));
    await page.evaluate(shiftClickLeaf(b));
    const pair = await page.evaluate<string[]>(SECTION_PATHS);
    check("#328 shift-clicking two leaves opens one section per file, alphabetical",
        await page.evaluate<boolean>(`document.getElementById('drawer').classList.contains('open')`)
        && JSON.stringify(pair) === JSON.stringify([a, b].sort()), { pair, a, b });

    // #dbody is a row flex for the single-file gutter+code; sections must opt out and stack.
    check("#328 sections stack vertically, never side by side",
        await page.evaluate<boolean>(`(() => {
        const [first, second] = document.querySelectorAll('#dbody details.dfile');
        return second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom;
    })()`));

    // Defaults: the single-pair header shape — on disk vs on disk, inline mode, full content on.
    await page.waitFor(bodySettled(a), 10_000);
    check("#328 a section is the single-pair pane defaulting to on disk / inline / full content",
        await page.evaluate<boolean>(`(() => {
        const d = ${sectionFor(a)};
        return d.querySelector('.dpair').textContent === 'on disk - on disk'
            && d.querySelectorAll('summary .dtools button').length === 4
            && d.querySelector('button[data-mode="inline"]').classList.contains('current')
            && d.querySelector('.dfull-toggle input').checked
            && d.querySelector('.dmeta').textContent.includes('base on disk → target on disk');
    })()`));

    // The pane cap: a section's body never grows past its max-height; long files scroll inside it.
    check("#328 a section's body is height-capped with its own scrollbar",
        await page.evaluate<boolean>(`(() => {
        const style = getComputedStyle(${sectionFor(a)}.querySelector('.dfile-body'));
        return style.maxHeight.endsWith('px') && style.overflowY === 'auto';
    })()`));

    // Stepping base ↑ (older) re-labels the pair and re-renders that section's diff.
    check("#328 stepping the base arrow shows a two-sided pair label",
        await page.evaluate<boolean>(`(() => {
        const arrows = [...${sectionFor(a)}.querySelectorAll('summary .dtools button')];
        if (arrows[0].disabled) return false;
        arrows[0].click();
        return ${sectionFor(a)}.querySelector('.dpair').textContent.endsWith(' - on disk')
            && !${sectionFor(a)}.querySelector('.dpair').textContent.startsWith('on disk');
    })()`));
    await page.waitFor(bodySettled(a), 10_000);
    // ↓ steps back to on disk, restoring the equal-sides default for the checks that follow.
    await page.evaluate(`[...${sectionFor(a)}.querySelectorAll('summary .dtools button')][1].click()`);
    await page.waitFor(bodySettled(a), 10_000);

    // The drawer-header pair drives every section at once.
    check("#328 collapse all closes every section and show all reopens them",
        await page.evaluate<boolean>(`(() => {
        document.getElementById('dcollapse-all').click();
        const closed = [...document.querySelectorAll('#dbody details.dfile')].every(d => !d.open);
        document.getElementById('dshow-all').click();
        return closed && [...document.querySelectorAll('#dbody details.dfile')].every(d => d.open);
    })()`));

    // The collapse mechanism is the native <details>: closing one hides its body, no JS.
    check("#328 a section collapses when its <details> closes", await page.evaluate<boolean>(`(() => {
        const d = document.querySelector('#dbody details.dfile');
        d.open = false;
        const hidden = d.querySelector('.dfile-body').offsetHeight === 0;
        d.open = true;
        return hidden;
    })()`));

    // Restore the leaf selection, then: a folder click shows every file in its subtree.
    await page.evaluate(shiftClickLeaf(a));
    await page.evaluate(shiftClickLeaf(b));
    const folder = await page.evaluate<string>(`[...document.querySelectorAll('#filenav-tree details.file-folder')]
        .find(d => d.querySelectorAll('.file-item').length >= 2)
        .querySelector('.file-folder-name').textContent`);
    const expected = await page.evaluate<string[]>(`[...[...document.querySelectorAll('#filenav-tree details.file-folder')]
        .find(d => d.querySelector('.file-folder-name').textContent === ${JSON.stringify(folder)})
        .querySelectorAll('.file-item')].map(i => i.dataset.target).sort()`);
    await page.evaluate(clickFolderName(folder));
    check("#328 a folder click renders one section per descendant file",
        JSON.stringify(await page.evaluate<string[]>(SECTION_PATHS)) === JSON.stringify(expected),
        { folder, expected });
    // A second plain click on the only-selected folder clears it (#254), restoring the nav state.
    await page.evaluate(clickFolderName(folder));
    // The multi-selections auto-armed Show Only Selected (task 326); disarm so the stage round-trips.
    await page.evaluate(`(() => {
        const toggle = document.getElementById('filenav-only-selected');
        if (toggle.classList.contains('current')) toggle.click();
    })()`);
}
