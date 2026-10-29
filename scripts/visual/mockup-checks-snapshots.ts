// Snapshot node, ruler row and drawer checks; split out of mockup-checks.ts, run order lives in mockup.ts.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { FADE_WAIT_MS, bubbleOf, buildShapeProbe, reportCheck, saveScreenshot } from "./mockup-checks.ts";

export async function validateSnapshotNodes(page: HeadlessPage): Promise<void> {
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
  // Task 386: the page has no `.hot` class; clicking a snapshot node is covered by the drawer checks.
  // reportCheck("#301 every snapshot node is clickable",
  //   await page.evaluate<boolean>(
  //     `[...document.querySelectorAll('.n-snap')].every(n => n.classList.contains('hot'))`));
  // Task 63: replaces the `.hot` check; the drawer opens a snapshot from a .node dot carrying session file and version.
  const dots = await page.evaluate<{ count: number; total: number; unclickable: number }>(`(() => {
        const dots = [...document.querySelectorAll('i.n-snap')];
        const unclickable = dots.filter(d => !d.classList.contains('node') || !d.dataset.sessionFile
          || !d.dataset.version || getComputedStyle(d).cursor !== 'pointer').length;
        return { count: dots.length, total: window.__fixture.SNAPSHOTS.length, unclickable };
    })()`);
  reportCheck("#301 every snapshot dot is clickable: a .node with session file, version and pointer cursor",
    dots.count === dots.total && dots.unclickable === 0, dots);
  reportCheck("#301 the show row carries a snapshot box",
    await page.evaluate<boolean>(
      `document.querySelector('#show-row input[data-kind="snapshot"]') !== null`));
  reportCheck("#259 a snapshot tied with the on-disk node joins a group of nodes with the same timestamp",
    await page.evaluate<number>(
      `document.querySelectorAll('${bubbleOf("src/index.ts")} .nodes-with-same-timestamp').length`) === 1);
  // Task 386: compared the page to itself since the layer switcher was retired.
  // reportCheck("#301 the bubble anchor stays on `created at`",
  //   await page.evaluate<string>(
  //     `document.querySelector('[data-path="src/index.ts"]').dataset.instant`) === indexAnchor);
  reportCheck("#301 the pre-commit snapshot sits between `created at` and the first commit",
    await page.evaluate<boolean>(`(() => {
        const cell = '${bubbleOf("src/index.ts")} .nlabel';
        const axisOf = n => Number(n.style.getPropertyValue('--axis-px'));
        const rows = [...document.querySelectorAll(cell)].sort((a, b) => axisOf(a) - axisOf(b)).map(n => n.textContent);
        return rows[0] === 'created at' && rows[1] === '@v1 📸' && /^[0-9a-f]{8}$/.test(rows[2]);
        })()`));
}

// Task 63: replaces #304's Layer 1 vs 2 compare; the snapshot box hides snapshots by CSS.
export async function validateSnapshotToggle(page: HeadlessPage): Promise<void> {
  const snapshotBox = `document.querySelector('#show-row input[data-kind="snapshot"]')`;
  const hiddenProbe = `[...document.querySelectorAll('${bubbleOf("src/index.ts")} .nlabel.n-snap')]
        .map(n => getComputedStyle(n).display === 'none')`;
  const before = await page.evaluate<string>(buildShapeProbe("README.md"));
  await page.evaluate(`${snapshotBox}.click()`);
  const unticked = await page.evaluate<string>(buildShapeProbe("README.md"));
  const hiddenWhileUnticked = await page.evaluate<boolean[]>(hiddenProbe);
  await page.evaluate(`${snapshotBox}.click()`);
  const reticked = await page.evaluate<string>(buildShapeProbe("README.md"));
  const hiddenAfterRetick = await page.evaluate<boolean[]>(hiddenProbe);
  const expectedLabels = await page.evaluate<string>(
    `window.__fixture.COMMITS.filter(c => c.files.includes('README.md'))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .map(c => c.hash.slice(0, 8)).concat('on disk').join('/')`);
  const readmeSnapCount = await page.evaluate<number>(
    `document.querySelectorAll('${bubbleOf("README.md")} .n-snap').length`);
  const boxTicked = await page.evaluate<boolean>(`${snapshotBox}.checked`);
  reportCheck("#304 unticking snapshots leaves a snapshot-free file exactly as it was",
    unticked === before, { before, unticked });
  reportCheck("#304 a snapshot-free file's labels are its fixture commits then 'on disk'",
    before.split(":")[1] === expectedLabels, { before, expectedLabels });
  reportCheck("#304 a snapshot-free file draws no snapshot node", readmeSnapCount === 0, readmeSnapCount);
  let allHiddenWhileUnticked = hiddenWhileUnticked.length > 0;
  for (const hidden of hiddenWhileUnticked) {
    if (!hidden) {
      allHiddenWhileUnticked = false;
    }
  }
  let allShownAfterRetick = hiddenAfterRetick.length > 0;
  for (const hidden of hiddenAfterRetick) {
    if (hidden) {
      allShownAfterRetick = false;
    }
  }
  reportCheck("#304 unticked snapshots are hidden", allHiddenWhileUnticked, hiddenWhileUnticked);
  reportCheck("#304 reticked snapshots show again", allShownAfterRetick, hiddenAfterRetick);
  reportCheck("#304 untick then retick lands back exactly where it started",
    reticked === before && boxTicked, { before, reticked, boxTicked });
}

export async function validateRulerRow(page: HeadlessPage): Promise<void> {
  const tickIndex = await page.evaluate<number>(`(() => {
        const ticks = [...document.querySelectorAll('.ruler .tick.multi')];
        return ticks.findIndex(t => t.textContent.startsWith('07-24 08:15:00'));
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
  // Module_36 bug: one row click must mark only the clicked node's dot (.node.found), never its label.
  const marked = await page.evaluate<string[]>(
    `[...document.querySelectorAll('.node.found')].map(n => n.nextElementSibling.textContent)`);
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
  await waitMilliseconds(FADE_WAIT_MS);
  reportCheck("#303 the highlight fades out on its own",
    await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 0);
  await page.evaluate(`document.querySelector('.ruler .tick.expanded').click()`);
  await waitMilliseconds(300);
}
