// Snapshot node, ruler row and drawer checks; split out of mockup-checks.ts, run order lives in mockup.ts.

import { pause, type HeadlessPage } from "./cdp.ts";
import { FADE_WAIT_MS, reportCheck, saveScreenshot } from "./mockup-checks.ts";

export async function validateSnapshotNodes(page: HeadlessPage, indexAnchor: string): Promise<void> {
  const labels = await page.evaluate<string[]>(
    `[...document.querySelectorAll('.nlabel')].map(n => n.textContent).filter(t => t.includes('📸'))`);
  const total = await page.evaluate<number>(`window.__fixture.SNAPSHOTS.length`);
  const labelCountMatchesTotal = labels.length === total;
  const versionedLabelPattern = /^@v\d 📸$/;
  let everyLabelIsVersioned = true;
  for (const label of labels) {
    const labelIsVersioned = versionedLabelPattern.test(label);
    if (!labelIsVersioned)
      everyLabelIsVersioned = false;
  }
  reportCheck("#301 one '@vN 📸' label per snapshot in the fixture",
    labelCountMatchesTotal && everyLabelIsVersioned, { drawn: labels.length, total });
  reportCheck("#301 every snapshot node is clickable",
    await page.evaluate<boolean>(
      `[...document.querySelectorAll('.n-snap')].every(n => n.classList.contains('hot'))`));
  reportCheck("#301 the legend carries a snapshot row",
    await page.evaluate<boolean>(
      `[...document.querySelectorAll('.legend span')].some(s => s.textContent.includes('📸'))`));
  reportCheck("#259 a snapshot tied with the on-disk node joins a group of nodes with the same timestamp",
    await page.evaluate<number>(
      `document.querySelectorAll('[data-path="src/index.ts"] .nodes-with-same-timestamp').length`) === 1);
  // The anchor cannot move: `born` is a node and no snapshot may pre-date it.
  reportCheck("#301 the bubble anchor stays on `created at`",
    await page.evaluate<string>(
      `document.querySelector('[data-path="src/index.ts"]').dataset.instant`) === indexAnchor);
  reportCheck("#301 the pre-commit snapshot sits between `created at` and the first commit",
    await page.evaluate<boolean>(`(() => {
        const cell = '[data-path="src/index.ts"] .nlabel';
        const rows = [...document.querySelectorAll(cell)].map(n => n.textContent);
        return rows[0] === 'created at' && rows[1] === '@v1 📸' && /^[0-9a-f]{8}$/.test(rows[2]);
        })()`));
}

export async function validateRulerRow(page: HeadlessPage): Promise<void> {
  const tickIndex = await page.evaluate<number>(`(() => {
        const ticks = [...document.querySelectorAll('.ruler .tick.multi')];
        return ticks.findIndex(t => t.dataset.instants.split(',')
            .some(x => Number(x) === Date.parse('2026-07-24T08:15:00Z')));
    })()`);
  reportCheck("#302 the snapshot's instant has its own expandable tick", tickIndex >= 0, tickIndex);
  if (tickIndex < 0) {
    return;
  }
  await page.evaluate(`document.querySelectorAll('.ruler .tick.multi')[${tickIndex}].click()`);
  await page.waitFor(`document.querySelectorAll('.tickfiles button').length > 0`, 5_000);
  const rows = await page.evaluate<string[]>(
    `[...document.querySelectorAll('.tickfiles button')].map(b => b.textContent)`);
  reportCheck("#302 a snapshot row reads '<file> @vN 📸'", rows.includes("index.ts  @v3 📸"), rows);
  const count = await page.evaluate<string>(
    `document.querySelector('.ruler .tick.expanded').textContent.match(/\\((\\d+)\\)/)[1]`);
  reportCheck("#302 the tick's (N) counts the snapshot too", Number(count) === rows.length, { count, rows });

  await page.evaluate(
    `document.querySelectorAll('.tickfiles button')[${rows.indexOf("index.ts  @v3 📸")}].click()`);
  const flash = await page.evaluate<{ file: string; ms: string; selected: number } | null>(`(() => {
        const f = document.querySelector('.session-item.flash');
        if (!f) return null;
        const selected = document.querySelectorAll('.session-item.selected').length;
        return { file: f.dataset.file, ms: f.style.getPropertyValue('--flash-ms'), selected };
    })()`);
  // The user hit this on module_36: one row click must mark only the clicked node.
  const marked = await page.evaluate<string[]>(
    `[...document.querySelectorAll('.nlabel.found')].map(n => n.dataset.event)`);
  reportCheck("#302 a snapshot row selects ONLY its snapshot, not the commit beside it",
    marked.length === 1 && marked[0] === "@v3 📸", marked);
  reportCheck("#303 the row flashes its OWNING session", flash?.file === "d4a06b8f.jsonl", flash);
  reportCheck("#303 the flashed JSONL is scrolled into view", await page.evaluate<boolean>(`(() => {
        const f = document.querySelector('.session-item.flash');
        const pane = document.getElementById('sessions').parentElement.getBoundingClientRect();
        const row = f.getBoundingClientRect();
        return row.bottom > pane.top && row.top < pane.bottom;
    })()`));
  reportCheck("#303 exactly one row flashes at a time",
    await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 1);
  reportCheck("#303 the flash does NOT select, so nothing is filtered", flash?.selected === 0, flash);
  reportCheck("#303 the fade duration comes from one findable constant", flash?.ms === "2600ms", flash);
  const background = await page.evaluate<string>(
    `getComputedStyle(document.querySelector('.session-item.flash')).backgroundColor`);
  reportCheck("#303 the flash colour is not the selection colour",
    background !== "rgba(0, 0, 0, 0)" && !background.includes("74, 58, 167"), background);
  await saveScreenshot(page, "03-flash");
  await pause(FADE_WAIT_MS);
  reportCheck("#303 the highlight fades out on its own",
    await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 0);
  await page.evaluate(`document.querySelector('.ruler .tick.expanded').click()`);
  await pause(300);
}

export async function validateDrawer(page: HeadlessPage): Promise<void> {
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
  reportCheck("#305 the header reads '<file> Snapshot - <title at that line range>'",
    early.head === "util.ts Snapshot - dispatch through one table", early.head);
  const late = await open(Date.parse("2026-07-24T08:00:00Z"));
  reportCheck("#305 the other @v2 resolves its OWN session's title",
    late.head === "util.ts Snapshot - cover the error branch, take notes", late.head);
  reportCheck("#300 two same-named @v2 snapshots hold DIFFERENT bytes", early.body !== late.body,
    { early: early.body.slice(0, 80), late: late.body.slice(0, 80) });
  reportCheck("#305 the drawer names the owning session", late.meta.includes("d4a06b8f.jsonl"), late.meta);
  const flashed = await page.evaluate<string | null>(
    `document.querySelector('.session-item.flash')?.dataset.file ?? null`);
  reportCheck("#305 clicking a snapshot node flashes its JSONL", flashed === "d4a06b8f.jsonl", flashed);
  // The hover ring and the [ ] brackets are two marks in one colour a few px apart (user).
  reportCheck("a selected node shows no hover ring",
    await page.evaluate<boolean>(`[...document.styleSheets[0].cssRules]
            .some(r => r.selectorText === '.node.hot:not(.found):hover')`));
  await saveScreenshot(page, "04-drawer");
}
