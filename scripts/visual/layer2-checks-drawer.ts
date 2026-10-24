// Ruler-row and drawer checks for the Layer 2 run; split out of layer2-checks.ts.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pause, type HeadlessPage } from "./cdp.ts";
import { validateCentring } from "./layer2-checks-centre.ts";
import { collectOwnerBasenames, type ViewPayload } from "./layer2-payload.ts";
import { reportCheck } from "./mockup-checks.ts";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "out");
const FADE_WAIT_MS = 3_000;

export async function saveScreenshot(page: HeadlessPage, name: string): Promise<void> {
  writeFileSync(join(OUT_DIR, `layer2-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
}

function clearWaitTimeout(): void {
}

// The flash fades after 2.6s; poll briefly so a read never races its arrival.
async function readFlashFile(page: HeadlessPage): Promise<string | null> {
  await page.waitFor(`document.querySelector('.session-item.flash')`, 2_000).catch(clearWaitTimeout);
  return page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`);
}

// Walk the expandable ruler rows until one lists a snapshot; leaves that row open on return.
async function findSnapshotRow(page: HeadlessPage): Promise<{ snap: string; count: number } | null> {
  const ticks = await page.evaluate<number>(`document.querySelectorAll('#ruler .tick.multi').length`);
  for (let i = 0; i < ticks; i++) {
    await page.evaluate(`document.querySelectorAll('#ruler .tick.multi')[${i}].click()`);
    await page.waitFor(`document.querySelectorAll('.tickfiles button').length > 0`, 5_000)
      .catch(clearWaitTimeout);
    const rows = await page.evaluate<string[]>(
      `[...document.querySelectorAll('.tickfiles button')].map(b => b.textContent)`);
    let snap: string | undefined;
    for (const row of rows) {
      const rowHasSnapshot = row.includes("📸");
      const snapNotYetFound = snap === undefined;
      const isFirstSnapshotRow = rowHasSnapshot && snapNotYetFound;
      if (isFirstSnapshotRow) {
        snap = row;
      }
    }
    if (snap !== undefined) {
      return { snap, count: rows.length };
    }
    await page.evaluate(`document.querySelector('#ruler .tick.expanded')?.click()`);
    await pause(120);
  }
  return null;
}

export async function validateRulerRow(page: HeadlessPage, payload: ViewPayload): Promise<void> {
  const found = await findSnapshotRow(page);
  const snapshotLabelPattern = /📸$/;
  const foundRowExists = found !== null;
  const labelEndsWithSnapshot = snapshotLabelPattern.test(found?.snap ?? "");
  const rowListsSnapshot = foundRowExists && labelEndsWithSnapshot;
  reportCheck("#316 an expandable ruler row lists a snapshot as '<file> @vN 📸'", rowListsSnapshot, found);
  if (found === null) {
    return;
  }
  await page.evaluate(
    `[...document.querySelectorAll('.tickfiles button')].find(b => b.textContent.includes('📸')).click()`);
  const flashFile = await readFlashFile(page);
  const selected = await page.evaluate<number>(`document.querySelectorAll('.session-item.selected').length`);
  reportCheck("#303 clicking a snapshot row flashes exactly one JSONL",
    await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 1, flashFile);
  reportCheck("#303 the flashed row is a real owning session from the payload",
    flashFile !== null && collectOwnerBasenames(payload).has(flashFile), flashFile);
  reportCheck("#303 the flash highlights, it does not select (nothing filtered)", selected === 0, selected);
  await saveScreenshot(page, "03-ruler-flash");
  await pause(FADE_WAIT_MS);
  reportCheck("#303 the highlight fades out on its own",
    await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 0);
  await page.evaluate(`document.querySelector('#ruler .tick.expanded')?.click()`);
  await pause(200);
}

// Replaced by layer2-checks-centre.ts, which picks a node that can really be centred.
/*
interface ClickedNodeView {
  node: number[];
  pane: number[];
  drawer: number[];
  area: number[];
  isInsidePane: boolean;
  touchesDrawer: boolean;
  isCentredOrClamped: boolean;
}

// Boxes are [left, top, right, bottom]; an axis may miss the centre by a few px, or when #timelines is scrolled to its end.
const READ_CLICKED_NODE_VIEW = `(() => {
    const pane = document.getElementById('timelines');
    const read = (element) => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
    const node = read(document.querySelector('#stage .node.found'));
    const paneBox = read(pane);
    const drawer = read(document.getElementById('drawer'));
    const area = [...paneBox];
    if (drawer[0] > paneBox[0] && drawer[0] < paneBox[2]) area[2] = drawer[0];
    const touchesDrawer = node[0] < drawer[2] && node[2] > drawer[0] && node[1] < drawer[3] && node[3] > drawer[1];
    const off = (axis) => (node[axis] + node[axis + 2]) / 2 - (area[axis] + area[axis + 2]) / 2;
    const maxLeft = pane.scrollWidth - pane.clientWidth;
    const maxTop = pane.scrollHeight - pane.clientHeight;
    const xClamped = pane.scrollLeft <= 1 || pane.scrollLeft >= maxLeft - 1;
    const yClamped = pane.scrollTop <= 1 || pane.scrollTop >= maxTop - 1;
    return { node, pane: paneBox, drawer, area,
        isInsidePane: node[0] >= paneBox[0] && node[1] >= paneBox[1] && node[2] <= paneBox[2] && node[3] <= paneBox[3],
        touchesDrawer,
        isCentredOrClamped: (Math.abs(off(0)) <= 4 || xClamped) && (Math.abs(off(1)) <= 4 || yClamped) };
})()`;
*/

export async function validateDrawer(page: HeadlessPage): Promise<void> {
  const owner = await page.evaluate<string>(`(() => {
        const snaps = [...document.querySelectorAll('.node.n-snap')].filter(n => n.offsetParent !== null);
        const n = snaps[Math.floor(snaps.length / 2)];
        n.click();
        return (n.dataset.sessionFile ?? '').split('/').pop();
    })()`);
  await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, 5_000);
  await page.waitFor(`document.getElementById('dbody').textContent.trim().length > 0`, 8_000);
  const drawer = await page.evaluate<{ head: string; meta: string; body: string }>(
    `({ head: document.getElementById('dpath').textContent,
            meta: document.getElementById('dmeta').textContent,
            body: document.getElementById('dbody').textContent })`);
  reportCheck("#305 the header reads '<file> Snapshot' (with '- <title>' when the session has one)",
    /^\S+ Snapshot( - .+)?$/.test(drawer.head), drawer.head);
  reportCheck("#305 the drawer names the owning session",
    drawer.meta.includes("file-history @v") && drawer.meta.includes(owner), drawer.meta);
  reportCheck("#305 the snapshot's bytes render", drawer.body.trim().length > 0, drawer.body.slice(0, 60));
  reportCheck("#317 clicking a snapshot node flashes its JSONL", await readFlashFile(page) === owner, owner);
  await pause(300);
  await saveScreenshot(page, "04-drawer");
  await validateCentring(page);
  await pause(FADE_WAIT_MS);
}
