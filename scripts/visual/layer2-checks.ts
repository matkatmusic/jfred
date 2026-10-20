// Task 318: the Layer 2 assertions against the real page; layer2.ts owns the server and data.

import { type HeadlessPage } from "./cdp.ts";
import { saveScreenshot, validateDrawer, validateRulerRow } from "./layer2-checks-drawer.ts";
import { countExpectedSnapshots, type ViewPayload } from "./layer2-payload.ts";
import { check } from "./mockup-checks.ts";

// Task 352 retired the layer switcher; its button helper, signature and checks are commented out.
// const LAYER = (n: number) => `document.querySelector('.layerbar button[data-layer="${n}"]')`;

/*
  Retired by task 352: signature of every bubble (path, axis offset, node labels).  const RENDER_SIGNATURE = `[...document.querySelectorAll('#stage .filebox')].map(b => (b.querySelector('.fname')?.dataset.path ?? '') + '@' + b.style.getPropertyValue('--axis-px') + ':' + [...b.querySelectorAll('.nlabel')].map(n => n.textContent).join('/')).join('|')`;
*/

// Snapshot labels the reader can actually SEE — the nodes exist at Layer 1 but CSS hides them.
const VISIBLE_SNAP_LABELS =
  `[...document.querySelectorAll('.nlabel.n-snap')].filter(n => n.offsetParent !== null).map(n => n.textContent)`;

async function validateChrome(page: HeadlessPage): Promise<void> {
  // const buttons = await page.evaluate<string[]>(
  //     `[...document.querySelectorAll('.layerbar button[data-layer]')].map(b => b.textContent)`);
  // check("#314 the layer row is exactly [1][2]", JSON.stringify(buttons) === '["1","2"]', buttons);
  // check("#314 nothing is left dimmed as uncomputed",
  //     await page.evaluate<number>(`document.querySelectorAll('.layerbar button.uncomputed').length`) === 0);
  // check("#314 [2] names file-history snapshots",
  //     await page.evaluate<string>(`${LAYER(2)}.title`) === "Layer 2 adds file-history snapshots");
}

async function validateLayer1HidesSnapshots(page: HeadlessPage): Promise<void> {
  // check("#314 the page opens on Layer 1",
  //     await page.evaluate<string>(`document.querySelector('.viz-root').dataset.layer`) === "1");
  check("#312 snapshot nodes are always in the DOM (shipped, not refetched)",
    await page.evaluate<number>(`document.querySelectorAll('.node.n-snap').length`) > 0);
  // check("#314 at Layer 1 no snapshot node is visible",
  //     (await page.evaluate<string[]>(VISIBLE_SNAP_LABELS)).length === 0);
}

async function openLayer2(page: HeadlessPage): Promise<void> {
  // await page.evaluate(`${LAYER(2)}.click()`);
  // await page.waitFor(`document.querySelector('.viz-root').dataset.layer === "2"`, 5_000);
  // check("#314 [2] carries .current and [1] does not", await page.evaluate<boolean>(
  //     `${LAYER(2)}.classList.contains('current') && !${LAYER(1)}.classList.contains('current')`));
}

async function validateSnapshotNodes(page: HeadlessPage, payload: ViewPayload): Promise<void> {
  const labels = await page.evaluate<string[]>(VISIBLE_SNAP_LABELS);
  const total = countExpectedSnapshots(payload);
  const versionedLabelPattern = /^@v\d+ 📸$/;
  let everyLabelIsVersioned = true;
  for (const label of labels) {
    const labelIsVersioned = versionedLabelPattern.test(label);
    if (!labelIsVersioned) {
      everyLabelIsVersioned = false;
    }
  }
  check("#315 one visible '@vN 📸' node per snapshot the payload shipped",
    labels.length === total && everyLabelIsVersioned, { drawn: labels.length, total });
  check("#315 the legend carries a snapshot swatch", await page.evaluate<boolean>(
    `[...document.querySelectorAll('.legend span')].some(s => s.textContent.includes('📸'))`));
  let bare: string | undefined;
  for (const pair of payload.pairs) {
    const pairHasNoSnapshots = (pair.snapshots?.length ?? 0) === 0;
    if (pairHasNoSnapshots && bare === undefined) {
      bare = pair.path;
    }
  }
  if (bare !== undefined) {
    check("#314 a snapshot-free file's bubble shows no 📸", await page.evaluate<boolean>(
      `[...document.querySelectorAll('.filebox .fname[data-path=${JSON.stringify(bare)}]')]
             .flatMap(f => [...f.closest('.filebox').querySelectorAll('.nlabel')].map(n => n.textContent))
             .every(t => !t.includes('📸'))`), bare);
  }
}

export async function executeLayer2Checks(page: HeadlessPage, payload: ViewPayload): Promise<void> {
  await validateChrome(page);
  await validateLayer1HidesSnapshots(page);
  // const layer1Signature = await page.evaluate<string>(RENDER_SIGNATURE);
  await saveScreenshot(page, "01-layer1");

  await openLayer2(page);
  await validateSnapshotNodes(page, payload);
  await saveScreenshot(page, "02-layer2");
  await validateRulerRow(page, payload);
  await validateDrawer(page);

  await page.evaluate(`document.getElementById('dclose').click()`);
  // await page.waitFor(`document.querySelector('.viz-root').dataset.layer === "1"`, 5_000);
  // check("#314 at Layer 1 again no snapshot node is visible",
  //     (await page.evaluate<string[]>(VISIBLE_SNAP_LABELS)).length === 0);
  // check("#314 1 -> 2 -> 1 lands back exactly where it started",
  //     await page.evaluate<string>(RENDER_SIGNATURE) === layer1Signature);
}
