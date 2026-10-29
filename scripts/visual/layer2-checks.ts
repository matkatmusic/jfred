// Task 318: the Layer 2 assertions against the real page; layer2.ts owns the server and data.

import { type HeadlessPage } from "./cdp.ts";
import { saveScreenshot, validateDrawer, validateRulerRow } from "./layer2-checks-drawer.ts";
import { countExpectedSnapshots, type ViewPayload } from "./layer2-payload.ts";
import { buildShapeProbe, reportCheck } from "./mockup-checks.ts";

// Task 352 retired the layer switcher; its button helper, signature and checks are commented out.
// const LAYER = (n: number) => `document.querySelector('.layerbar button[data-layer="${n}"]')`;

// RENDER_SIGNATURE lives in mockup-checks.ts; the 1 -> 2 -> 1 check was retired by task 352.

// Snapshot labels the reader can actually SEE — the nodes exist at Layer 1 but CSS hides them.
const VISIBLE_SNAP_LABELS =
  `[...document.querySelectorAll('.nlabel.n-snap')].filter(n => n.offsetParent !== null).map(n => n.textContent)`;

async function validateChrome(page: HeadlessPage): Promise<void> {
  // const buttons = await page.evaluate<string[]>(
  //     `[...document.querySelectorAll('.layerbar button[data-layer]')].map(b => b.textContent)`);
  // reportCheck("#314 the layer row is exactly [1][2]", JSON.stringify(buttons) === '["1","2"]', buttons);
  // reportCheck("#314 nothing is left dimmed as uncomputed",
  //     await page.evaluate<number>(`document.querySelectorAll('.layerbar button.uncomputed').length`) === 0);
  // reportCheck("#314 [2] names file-history snapshots",
  //     await page.evaluate<string>(`${LAYER(2)}.title`) === "Layer 2 adds file-history snapshots");
}

async function validateLayer1HidesSnapshots(page: HeadlessPage): Promise<void> {
  // reportCheck("#314 the page opens on Layer 1",
  //     await page.evaluate<string>(`document.querySelector('.viz-root').dataset.layer`) === "1");
  reportCheck("#312 snapshot nodes are always in the DOM (shipped, not refetched)",
    await page.evaluate<number>(`document.querySelectorAll('.node.n-snap').length`) > 0);
  // Task 64: validateSnapshotToggle replaces these.
  // reportCheck("#314 at Layer 1 no snapshot node is visible",
  //     (await page.evaluate<string[]>(VISIBLE_SNAP_LABELS)).length === 0);
}

// Task 64: replaces the #314 Layer 1 and 1->2->1 checks; snapshot box hides by CSS, no re-layout.
async function validateSnapshotToggle(page: HeadlessPage, payload: ViewPayload): Promise<void> {
  const snapshotBox = `document.querySelector('#show-row input[data-kind="snapshot"]')`;
  let bare: string | undefined;
  for (const pair of payload.pairs) {
    const pairHasNoSnapshots = (pair.snapshots?.length ?? 0) === 0;
    const bareNotYetFound = bare === undefined;
    const isFirstBarePair = pairHasNoSnapshots && bareNotYetFound;
    if (isFirstBarePair) {
      bare = pair.path;
    }
  }
  reportCheck("#314 the payload has a snapshot-free file to compare against", bare !== undefined);
  if (bare === undefined) {
    return;
  }
  const before = await page.evaluate<string>(buildShapeProbe(bare));
  await page.evaluate(`${snapshotBox}.click()`);
  const unticked = await page.evaluate<string>(buildShapeProbe(bare));
  const visibleWhileUnticked = await page.evaluate<string[]>(VISIBLE_SNAP_LABELS);
  await page.evaluate(`${snapshotBox}.click()`);
  const reticked = await page.evaluate<string>(buildShapeProbe(bare));
  const visibleAfterRetick = await page.evaluate<string[]>(VISIBLE_SNAP_LABELS);
  const boxTicked = await page.evaluate<boolean>(`${snapshotBox}.checked`);
  const total = countExpectedSnapshots(payload);
  reportCheck("#314 unticked snapshots: no snapshot node is visible",
    visibleWhileUnticked.length === 0, visibleWhileUnticked);
  reportCheck("#314 unticking snapshots leaves a snapshot-free file exactly as it was",
    unticked === before, { before, unticked });
  reportCheck("#314 reticked snapshots show again",
    visibleAfterRetick.length === total, { visible: visibleAfterRetick.length, total });
  reportCheck("#314 untick then retick lands back exactly where it started",
    reticked === before && boxTicked, { before, reticked, boxTicked });
}

async function openLayer2(page: HeadlessPage): Promise<void> {
  // await page.evaluate(`${LAYER(2)}.click()`);
  // await page.waitFor(`document.querySelector('.viz-root').dataset.layer === "2"`, 5_000);
  // reportCheck("#314 [2] carries .current and [1] does not", await page.evaluate<boolean>(
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
  reportCheck("#315 one visible '@vN 📸' node per snapshot the payload shipped",
    labels.length === total && everyLabelIsVersioned, { drawn: labels.length, total });
  // Task 64: the drawer opens a snapshot from a .node dot carrying session file and version.
  const dots = await page.evaluate<{ count: number; unclickable: number }>(`(() => {
        const dots = [...document.querySelectorAll('i.n-snap')];
        const unclickable = dots.filter(d => !d.classList.contains('node') || !d.dataset.sessionFile
          || !d.dataset.version || getComputedStyle(d).cursor !== 'pointer').length;
        return { count: dots.length, unclickable };
    })()`);
  reportCheck("#315 every snapshot dot is clickable: a .node with session file, version and pointer cursor",
    dots.count === total && dots.unclickable === 0, { ...dots, total });
  reportCheck("#315 the show row carries a snapshot box", await page.evaluate<boolean>(
    `document.querySelector('#show-row input[data-kind="snapshot"]') !== null`));
  let bare: string | undefined;
  for (const pair of payload.pairs) {
    const pairHasNoSnapshots = (pair.snapshots?.length ?? 0) === 0;
    const bareNotYetFound = bare === undefined;
    const isFirstBarePair = pairHasNoSnapshots && bareNotYetFound;
    if (isFirstBarePair) {
      bare = pair.path;
    }
  }
  if (bare !== undefined) {
    reportCheck("#314 a snapshot-free file's bubble shows no 📸", await page.evaluate<boolean>(
      `[...document.querySelectorAll('.filebox .fname[data-path=${JSON.stringify(bare)}]')]
             .flatMap(f => [...f.closest('.filebox').querySelectorAll('.nlabel')].map(n => n.textContent))
             .every(t => !t.includes('📸'))`), bare);
  }
}

export async function executeLayer2Checks(page: HeadlessPage, payload: ViewPayload): Promise<void> {
  await validateChrome(page);
  await validateLayer1HidesSnapshots(page);
  await validateSnapshotToggle(page, payload);
  // const layer1Signature = await page.evaluate<string>(RENDER_SIGNATURE);
  await saveScreenshot(page, "01-layer1");

  await openLayer2(page);
  await validateSnapshotNodes(page, payload);
  await saveScreenshot(page, "02-layer2");
  await validateRulerRow(page, payload);
  await validateDrawer(page);

  await page.evaluate(`document.getElementById('dclose').click()`);
  // Task 64: validateSnapshotToggle replaces these.
  // await page.waitFor(`document.querySelector('.viz-root').dataset.layer === "1"`, 5_000);
  // reportCheck("#314 at Layer 1 again no snapshot node is visible",
  //     (await page.evaluate<string[]>(VISIBLE_SNAP_LABELS)).length === 0);
  // reportCheck("#314 1 -> 2 -> 1 lands back exactly where it started",
  //     await page.evaluate<string>(RENDER_SIGNATURE) === layer1Signature);
}
