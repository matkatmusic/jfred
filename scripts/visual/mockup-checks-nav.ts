// Tasks #308/#309 — the two JSONL-pane behaviours. Its own file because mockup-checks.ts is at the
// 250-line cap; the run order still lives in mockup.ts.

import { type HeadlessPage } from "./cdp.ts";
import { check } from "./mockup-checks.ts";

// The bubble the most sessions touched, so a point-sensitive lead has somewhere to move to.
const BUSIEST_PATH = `(() => {
    const touch = p => window.__fixture.SESSIONS.filter(s => s.paths.includes(p)).length;
    return [...document.querySelectorAll('.filebox[data-path]')]
        .map(b => b.dataset.path).sort((a, b) => touch(b) - touch(a))[0];
})()`;

// Clicks the bubble BESIDE one of its nodes — a bubble runs to ~10,000 px, so "5% down" is months
// away from its first node and would say nothing about the point-to-instant lookup. The event is
// dispatched on the box, never on the node, so this is a bubble click and not a drawer click.
const clickBesideNode = (path: string, which: "0" | "-1") => `(() => {
    const box = document.querySelector('.filebox[data-path=${JSON.stringify(path)}]');
    const node = [...box.querySelectorAll('.node')].at(${which}).getBoundingClientRect();
    box.dispatchEvent(new MouseEvent('click', { bubbles: true,
        clientX: box.getBoundingClientRect().left + 4, clientY: node.top + node.height / 2 }));
    return [...document.querySelectorAll('.session-item.flash')].map(i => i.dataset.file);
})()`;

const LEAD = `document.querySelector('.session-item.flash-lead')?.dataset.file ?? null`;

// The session the page SHOULD lead with for a click level with this bubble's first (or last) node:
// the window nearest that node's own instant, which is the answer the page's ruler lookup owes.
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
