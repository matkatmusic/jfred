// Ruler-row and drawer checks for the Layer 2 run; split out of layer2-checks.ts.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pause, type HeadlessPage } from "./cdp.ts";
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

export async function validateDrawer(page: HeadlessPage): Promise<void> {
  const owner = await page.evaluate<string>(`(() => {
        const n = [...document.querySelectorAll('.node.n-snap')].find(n => n.offsetParent !== null);
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
  await saveScreenshot(page, "04-drawer");
  await pause(FADE_WAIT_MS);
}
