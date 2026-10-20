// Assertion groups for the Layer 2 mockup run; mockup.ts owns the server, page and order.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "./cdp.ts";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "out");
// How long the flash gets to finish. FLASH_MS in the mockup is 2600.
export const FADE_WAIT_MS = 3_000;

export const failures: string[] = [];
export function check(name: string, ok: boolean, detail: unknown = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${JSON.stringify(detail)}`}`);
  if (!ok) {
    failures.push(name);
  }
}

// A bubble's identity: its anchor instant and node rows, in order.
export const buildShapeProbe =(path: string) =>
  `(b => b.dataset.instant + ':' + [...b.querySelectorAll('.nlabel')].map(n => n.textContent).join('/'))
     (document.querySelector('.filebox[data-path="${path}"]'))`;

// Every bubble's path, offset and node rows — the whole-render signature #304's idempotency needs.
export const RENDER_SIGNATURE =
  `[...document.querySelectorAll('.filebox')].map(b => b.dataset.path + '@' +
        b.style.getPropertyValue('--axis-px') + ':' +
        [...b.querySelectorAll('.nlabel')].map(n => n.textContent).join('/')).join('|')`;

export async function saveScreenshot(page: HeadlessPage, name: string): Promise<void> {
  writeFileSync(join(OUT_DIR, `mockup-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
}

export async function validateChrome(page: HeadlessPage): Promise<void> {
  // Task 352 retired the layer switcher, so its chrome checks are commented out.
  // const buttons = await page.evaluate<string[]>(
  //     `[...document.querySelectorAll('.layerbar button')].map(b => b.textContent)`);
  // check("#299 the layer row is exactly [1][2]", JSON.stringify(buttons) === '["1","2"]', buttons);
  // check("#299 nothing is left dimmed as uncomputed",
  //     await page.evaluate<number>(`document.querySelectorAll('.layerbar button.uncomputed').length`) === 0);
  // check("#299 [2] names file-history snapshots",
  //     await page.evaluate<string>(`document.querySelector('[data-layer="2"]').title`)
  //         === "Layer 2 adds file-history snapshots");
}

export async function validateNavRows(page: HeadlessPage): Promise<void> {
  const rows = await page.evaluate<{ file: string; kids: string[] }[]>(
    `[...document.querySelectorAll('.session-item')].map(i => ({
            file: i.dataset.file, kids: [...i.children].map(c => c.className + '|' + c.textContent) }))`);
  const isWellFormed = (kids: string[]) => {
    const firstIsName = (kids[0] ?? "").startsWith("sname");
    const lastIsMeta = (kids[kids.length - 1] ?? "").startsWith("smeta");
    let middleAreTitles = true;
    for (const kid of kids.slice(1, -1)) {
      const kidIsTitle = kid.startsWith("stitle");
      if (!kidIsTitle)
        middleAreTitles = false;
    }
    return firstIsName && lastIsMeta && middleAreTitles;
  };
  let everyRowWellFormed = rows.length > 0;
  for (const row of rows) {
    const rowIsWellFormed = isWellFormed(row.kids);
    if (!rowIsWellFormed)
      everyRowWellFormed = false;
  }
  check("#306 every row reads sname, then title(s), then the timestamp",
    everyRowWellFormed, rows.slice(0, 4));
  check("#306 a titled session leads with its title",
    rows[0]?.kids[1] === "stitle|seed the demo app", rows[0]?.kids);
  let secondRowTitleCount = 0;
  for (const kid of rows[1]?.kids ?? []) {
    const kidIsTitle = kid.startsWith("stitle");
    if (kidIsTitle)
      secondRowTitleCount += 1;
  }
  const secondRowHasTwoTitles = secondRowTitleCount === 2;
  check("#306 a twice-renamed session prints BOTH titles",
    secondRowHasTwoTitles, rows[1]?.kids);
  check("#306 an unnamed session prints no title row at all",
    rows[2]?.file === "7ce50a19.jsonl" && rows[2]?.kids.length === 2, rows[2]);
}

export async function validateScale(page: HeadlessPage): Promise<void> {
  const size = await page.evaluate<{ snaps: number; files: number }>(
    `({ snaps: window.__fixture.SNAPSHOTS.length, files: window.__fixture.DISK.length })`);
  check("#300 the fixture is big enough to be worth scrolling", size.snaps >= 60 && size.files >= 80, size);
  const extent = await page.evaluate<{ w: number; h: number; vw: number; vh: number }>(
    `(p => ({ w: p.scrollWidth, h: p.scrollHeight, vw: p.clientWidth, vh: p.clientHeight }))
         (document.getElementById('timelines'))`);
  check("#300 the stage scrolls HORIZONTALLY (>3 viewports)", extent.w > extent.vw * 3, extent);
  check("#300 the stage scrolls VERTICALLY (>3 viewports)", extent.h > extent.vh * 3, extent);
}

// Re-checks the fixture's own ordering rules from outside, so a skipped self-check cannot look green.
export async function validateOrdering(page: HeadlessPage): Promise<void> {
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
