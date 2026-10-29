// Tasks #308/#309 — File Nav pane checks; separate file because mockup-checks.ts is at cap.

import { type HeadlessPage } from "./cdp.ts";
import { BUBBLES, buildBubbleSelector, reportCheck } from "./mockup-checks.ts";

// The bubble the most sessions touched, so a point-sensitive lead has somewhere to move to.
const BUSIEST_PATH = `(() => {
    const touch = p => window.__fixture.SESSIONS.filter(s => s.paths.includes(p)).length;
    return [...document.querySelectorAll('${BUBBLES}')]
        .map(b => b.querySelector('.fname').dataset.path).sort((a, b) => touch(b) - touch(a))[0];
})()`;

// Clicks the box beside a node (never the node itself), so it lands as a bubble click.
const buildClickBesideNodeScript = (path: string, which: "0" | "-1") => `(() => {
    const box = document.querySelector('${buildBubbleSelector(path)}');
    const node = [...box.querySelectorAll('.node')].at(${which}).getBoundingClientRect();
    box.dispatchEvent(new MouseEvent('click', { bubbles: true,
        clientX: box.getBoundingClientRect().left + 4, clientY: node.top + node.height / 2 }));
    return [...document.querySelectorAll('.session-item.flash')].map(i => i.dataset.file);
})()`;

const LEAD = `document.querySelector('.session-item.flash-lead')?.dataset.file ?? null`;

// The session whose time window sits nearest the clicked node's instant.
const buildExpectedLeadScript = (path: string, which: "0" | "-1") => `(() => {
    const rows = [...document.querySelectorAll('${buildBubbleSelector(path)} .node')];
    const t = Date.parse(rows.at(${which}).dataset.instant);
    const gap = s => Math.max(0, Date.parse(s.started) - t, t - Date.parse(s.ended));
    return window.__fixture.SESSIONS.filter(s => s.paths.includes(${JSON.stringify(path)}))
        .sort((a, b) => gap(a) - gap(b))[0].file;
})()`;

export async function validateBubbleFlash(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string>(BUSIEST_PATH);
  const expected = await page.evaluate<string[]>(
    `window.__fixture.SESSIONS.filter(s => s.paths.includes(${JSON.stringify(path)})).map(s => s.file)`);
  const flashed = await page.evaluate<string[]>(buildClickBesideNodeScript(path, "0"));
  reportCheck("#308 a bubble click flashes every JSONL that touched that file",
    JSON.stringify([...flashed].sort()) === JSON.stringify([...expected].sort()), { flashed, expected });
  reportCheck("#308 highlighting is not selecting — no session is filtered by the click",
    await page.evaluate<number>(`document.querySelectorAll('.session-item.selected').length`) === 0);
  const leadTop = await page.evaluate<string | null>(LEAD);
  reportCheck("#308 a click at the TOP of the bubble leads with the session nearest THAT instant",
    leadTop === await page.evaluate<string>(buildExpectedLeadScript(path, "0")), { path, leadTop });
  await page.evaluate(buildClickBesideNodeScript(path, "-1"));
  const leadBottom = await page.evaluate<string | null>(LEAD);
  reportCheck("#308 a click at the BOTTOM leads with the session nearest the LAST node's instant",
    leadBottom === await page.evaluate<string>(buildExpectedLeadScript(path, "-1")), { path, leadBottom });
}

const buildTypeSearchScript = (text: string) => `(() => {
    const box = document.getElementById('session-search');
    box.value = ${JSON.stringify(text)};
    box.dispatchEvent(new Event('input'));
    return [...document.querySelectorAll('.session-item')].map(i => i.dataset.file);
})()`;

export async function validateSessionSearch(page: HeadlessPage): Promise<void> {
  const bubblesBefore = await page.evaluate<number>(`document.querySelectorAll('.filebox').length`);
  const all = await page.evaluate<number>(`window.__fixture.SESSIONS.length`);
  const term = await page.evaluate<string>(
    `window.__fixture.SESSIONS.flatMap(s => s.titles).map(t => t.title)[0].split(' ')[0]`);
  const expected = await page.evaluate<string[]>(`window.__fixture.SESSIONS.filter(s =>
        [...new Set(s.titles.map(t => t.title))]
            .some(t => t.toLowerCase().includes(${JSON.stringify(term)}.toLowerCase()))).map(s => s.file)`);
  const shown = await page.evaluate<string[]>(buildTypeSearchScript(term));
  reportCheck("#309 the box filters the JSONL list by customTitle",
    JSON.stringify(shown) === JSON.stringify(expected), { term, shown, expected });
  reportCheck("#309 an unnamed session is gone while the box has text",
    !shown.includes("7ce50a19.jsonl"), shown);
  reportCheck("#309 filtering the LIST does not filter the TIMELINE",
    await page.evaluate<number>(`document.querySelectorAll('.filebox').length`) === bubblesBefore);
  reportCheck("#309 a term nothing matches empties the list and says so",
    (await page.evaluate<string[]>(buildTypeSearchScript("zzz-no-such-title"))).length === 0
        && await page.evaluate<number>(`document.querySelectorAll('#sessions .navempty').length`) === 1);
  await page.evaluate(`document.getElementById('session-search-clear').click()`);
  reportCheck("#309 the clear button restores every session",
    await page.evaluate<number>(`document.querySelectorAll('.session-item').length`) === all);
}
