// The assertion groups for the Layer 2 mockup run. Split out of mockup.ts, which owns the server,
// the page and the order they run in — this file only knows what "correct" looks like.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pause, type HeadlessPage } from "./cdp.ts";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "out");
// How long the flash gets to finish. FLASH_MS in the mockup is 2600.
const FADE_WAIT_MS = 3_000;

export const failures: string[] = [];
export function check(name: string, ok: boolean, detail: unknown = ""): void {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${JSON.stringify(detail)}`}`);
    if (!ok) {
        failures.push(name);
    }
}

// The bubble's identity as the page draws it: its anchor instant and its node rows, in order. Two
// renders that agree on this are the same render — which is what "Layer 1 is unchanged" must mean.
export const shapeOf = (path: string) =>
    `(b => b.dataset.instant + ':' + [...b.querySelectorAll('.nlabel')].map(n => n.textContent).join('/'))
     (document.querySelector('.filebox[data-path="${path}"]'))`;

// Every bubble's path, offset and node rows — the whole-render signature #304's idempotency needs.
export const RENDER_SIGNATURE =
    `[...document.querySelectorAll('.filebox')].map(b => b.dataset.path + '@' +
        b.style.getPropertyValue('--axis-px') + ':' +
        [...b.querySelectorAll('.nlabel')].map(n => n.textContent).join('/')).join('|')`;

export async function shoot(page: HeadlessPage, name: string): Promise<void> {
    writeFileSync(join(OUT_DIR, `mockup-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
}

export async function checkChrome(page: HeadlessPage): Promise<void> {
    const buttons = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.layerbar button')].map(b => b.textContent)`);
    check("#299 the layer row is exactly [1][2]", JSON.stringify(buttons) === '["1","2"]', buttons);
    check("#299 nothing is left dimmed as uncomputed",
        await page.evaluate<number>(`document.querySelectorAll('.layerbar button.uncomputed').length`) === 0);
    check("#299 [2] names file-history snapshots",
        await page.evaluate<string>(`document.querySelector('[data-layer="2"]').title`)
            === "Layer 2 adds file-history snapshots");
}

export async function checkNavRows(page: HeadlessPage): Promise<void> {
    const rows = await page.evaluate<{ file: string; kids: string[] }[]>(
        `[...document.querySelectorAll('.session-item')].map(i => ({
            file: i.dataset.file, kids: [...i.children].map(c => c.className + '|' + c.textContent) }))`);
    const wellFormed = (kids: string[]) => (kids[0] ?? "").startsWith("sname")
        && (kids[kids.length - 1] ?? "").startsWith("smeta")
        && kids.slice(1, -1).every(k => k.startsWith("stitle"));
    check("#306 every row reads sname, then title(s), then the timestamp",
        rows.length > 0 && rows.every(r => wellFormed(r.kids)), rows.slice(0, 4));
    check("#306 a titled session leads with its title",
        rows[0]?.kids[1] === "stitle|seed the demo app", rows[0]?.kids);
    check("#306 a twice-renamed session prints BOTH titles",
        (rows[1]?.kids ?? []).filter(k => k.startsWith("stitle")).length === 2, rows[1]?.kids);
    check("#306 an unnamed session prints no title row at all",
        rows[2]?.file === "7ce50a19.jsonl" && rows[2]?.kids.length === 2, rows[2]);
}

export async function checkScale(page: HeadlessPage): Promise<void> {
    const size = await page.evaluate<{ snaps: number; files: number }>(
        `({ snaps: window.__fixture.SNAPSHOTS.length, files: window.__fixture.DISK.length })`);
    check("#300 the fixture is big enough to be worth scrolling", size.snaps >= 60 && size.files >= 80, size);
    const extent = await page.evaluate<{ w: number; h: number; vw: number; vh: number }>(
        `(p => ({ w: p.scrollWidth, h: p.scrollHeight, vw: p.clientWidth, vh: p.clientHeight }))
         (document.getElementById('timelines'))`);
    check("#300 the stage scrolls HORIZONTALLY (>3 viewports)", extent.w > extent.vw * 3, extent);
    check("#300 the stage scrolls VERTICALLY (>3 viewports)", extent.h > extent.vh * 3, extent);
}

// The ordering rules the fixture's own self-check enforces, re-checked from outside it: a load that
// silently skipped the assert would otherwise still look green here.
export async function checkOrdering(page: HeadlessPage): Promise<void> {
    const broken = await page.evaluate<{ born: string[]; mtime: string[]; coTimed: number }>(`(() => {
        const { COMMITS, DISK, SNAPSHOTS } = window.__fixture;
        const bornOf = new Map(DISK.map(d => [d.path, Date.parse(d.born)]));
        const mtimeOf = new Map(DISK.map(d => [d.path, Date.parse(d.at)]));
        const key = s => s.path + s.version;
        const commitKeys = COMMITS.flatMap(c => c.files.map(f => f + '@' + Date.parse(c.at)));
        const others = new Set([...commitKeys, ...DISK.map(d => d.path + '@' + Date.parse(d.at))]);
        return {
            born: SNAPSHOTS.filter(s => Date.parse(s.at) < bornOf.get(s.path)).map(key),
            mtime: SNAPSHOTS.filter(s => Date.parse(s.at) > mtimeOf.get(s.path)).map(key),
            coTimed: SNAPSHOTS.filter(s => others.has(s.path + '@' + Date.parse(s.at))).length,
        };
    })()`);
    check("#300 no snapshot pre-dates its file's DISK born", broken.born.length === 0, broken.born);
    check("#300 no snapshot post-dates its file's on-disk mtime", broken.mtime.length === 0, broken.mtime);
    check("#302 many snapshots share an instant with a commit or an mtime", broken.coTimed >= 20, broken.coTimed);
    check("#302 the ruler has many expandable multi-event rows",
        await page.evaluate<number>(`document.querySelectorAll('.ruler .tick.multi').length`) >= 20);
}

export async function checkSnapshotNodes(page: HeadlessPage, indexAnchor: string): Promise<void> {
    const labels = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.nlabel')].map(n => n.textContent).filter(t => t.includes('📸'))`);
    const total = await page.evaluate<number>(`window.__fixture.SNAPSHOTS.length`);
    check("#301 one '@vN 📸' label per snapshot in the fixture",
        labels.length === total && labels.every(t => /^@v\d 📸$/.test(t)), { drawn: labels.length, total });
    check("#301 every snapshot node is clickable",
        await page.evaluate<boolean>(
            `[...document.querySelectorAll('.n-snap')].every(n => n.classList.contains('hot'))`));
    check("#301 the legend carries a snapshot row",
        await page.evaluate<boolean>(
            `[...document.querySelectorAll('.legend span')].some(s => s.textContent.includes('📸'))`));
    check("#259 a snapshot tied with the on-disk node joins a tie group",
        await page.evaluate<number>(
            `document.querySelectorAll('[data-path="src/index.ts"] .tiegroup').length`) === 1);
    // The anchor CANNOT move: `born` is itself a node and no snapshot may pre-date it. What the
    // pre-commit snapshot does instead is take a ruler entry above every commit.
    check("#301 the bubble anchor stays on `created at`",
        await page.evaluate<string>(
            `document.querySelector('[data-path="src/index.ts"]').dataset.instant`) === indexAnchor);
    check("#301 the pre-commit snapshot sits between `created at` and the first commit",
        await page.evaluate<boolean>(`(() => {
        const cell = '[data-path="src/index.ts"] .nlabel';
        const rows = [...document.querySelectorAll(cell)].map(n => n.textContent);
        return rows[0] === 'created at' && rows[1] === '@v1 📸' && /^[0-9a-f]{8}$/.test(rows[2]);
        })()`));
}

export async function checkRulerRow(page: HeadlessPage): Promise<void> {
    const tickIndex = await page.evaluate<number>(`(() => {
        const ticks = [...document.querySelectorAll('.ruler .tick.multi')];
        return ticks.findIndex(t => t.dataset.instants.split(',')
            .some(x => Number(x) === Date.parse('2026-07-24T08:15:00Z')));
    })()`);
    check("#302 the snapshot's instant has its own expandable tick", tickIndex >= 0, tickIndex);
    if (tickIndex < 0) {
        return;
    }
    await page.evaluate(`document.querySelectorAll('.ruler .tick.multi')[${tickIndex}].click()`);
    await page.waitFor(`document.querySelectorAll('.tickfiles button').length > 0`, 5_000);
    const rows = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.tickfiles button')].map(b => b.textContent)`);
    check("#302 a snapshot row reads '<file> @vN 📸'", rows.includes("index.ts  @v3 📸"), rows);
    const count = await page.evaluate<string>(
        `document.querySelector('.ruler .tick.expanded').textContent.match(/\\((\\d+)\\)/)[1]`);
    check("#302 the tick's (N) counts the snapshot too", Number(count) === rows.length, { count, rows });

    await page.evaluate(
        `document.querySelectorAll('.tickfiles button')[${rows.indexOf("index.ts  @v3 📸")}].click()`);
    const flash = await page.evaluate<{ file: string; ms: string; selected: number } | null>(`(() => {
        const f = document.querySelector('.session-item.flash');
        if (!f) return null;
        const selected = document.querySelectorAll('.session-item.selected').length;
        return { file: f.dataset.file, ms: f.style.getPropertyValue('--flash-ms'), selected };
    })()`);
    // The bug the user hit on module_36: a path plus an instant names TWO nodes when a commit and a
    // snapshot share a second, so clicking one row lit both. Only what was clicked may be marked.
    const marked = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.nlabel.found')].map(n => n.dataset.event)`);
    check("#302 a snapshot row selects ONLY its snapshot, not the commit beside it",
        marked.length === 1 && marked[0] === "@v3 📸", marked);
    check("#303 the row flashes its OWNING session", flash?.file === "d4a06b8f.jsonl", flash);
    check("#303 the flashed JSONL is scrolled into view", await page.evaluate<boolean>(`(() => {
        const f = document.querySelector('.session-item.flash');
        const pane = document.getElementById('sessions').parentElement.getBoundingClientRect();
        const row = f.getBoundingClientRect();
        return row.bottom > pane.top && row.top < pane.bottom;
    })()`));
    check("#303 exactly one row flashes at a time",
        await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 1);
    check("#303 the flash does NOT select, so nothing is filtered", flash?.selected === 0, flash);
    check("#303 the fade duration comes from one findable constant", flash?.ms === "2600ms", flash);
    const background = await page.evaluate<string>(
        `getComputedStyle(document.querySelector('.session-item.flash')).backgroundColor`);
    check("#303 the flash colour is not the selection colour",
        background !== "rgba(0, 0, 0, 0)" && !background.includes("74, 58, 167"), background);
    await shoot(page, "03-flash");
    await pause(FADE_WAIT_MS);
    check("#303 the highlight fades out on its own",
        await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 0);
    await page.evaluate(`document.querySelector('.ruler .tick.expanded').click()`);
    await pause(300);
}

export async function checkDrawer(page: HeadlessPage): Promise<void> {
    const open = async (instant: number) => {
        await page.evaluate(`[...document.querySelectorAll('[data-path="src/util.ts"] .n-snap')]
            .find(n => n.dataset.instant === '${instant}').click()`);
        await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, 5_000);
        return page.evaluate<{ head: string; meta: string; body: string }>(
            `({ head: document.getElementById('dpath').textContent,
            meta: document.getElementById('dmeta').textContent,
            body: document.getElementById('dbody').textContent })`);
    };
    const early = await open(Date.parse("2026-06-03T10:30:00Z"));
    check("#305 the header reads '<file> Snapshot - <title at that line range>'",
        early.head === "util.ts Snapshot - dispatch through one table", early.head);
    const late = await open(Date.parse("2026-07-24T08:00:00Z"));
    check("#305 the other @v2 resolves its OWN session's title",
        late.head === "util.ts Snapshot - cover the error branch, take notes", late.head);
    check("#300 two same-named @v2 snapshots hold DIFFERENT bytes", early.body !== late.body,
        { early: early.body.slice(0, 80), late: late.body.slice(0, 80) });
    check("#305 the drawer names the owning session", late.meta.includes("d4a06b8f.jsonl"), late.meta);
    const flashed = await page.evaluate<string | null>(
        `document.querySelector('.session-item.flash')?.dataset.file ?? null`);
    check("#305 clicking a snapshot node flashes its JSONL", flashed === "d4a06b8f.jsonl", flashed);
    // The hover ring and the [ ] brackets are two marks in one colour a few px apart (user).
    check("a selected node shows no hover ring",
        await page.evaluate<boolean>(`[...document.styleSheets[0].cssRules]
            .some(r => r.selectorText === '.node.hot:not(.found):hover')`));
    await shoot(page, "04-drawer");
}
