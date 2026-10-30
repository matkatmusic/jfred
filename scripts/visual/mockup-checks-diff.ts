// Tasks #324/#329: the DiffView pane's pair behaviours. Nav and Show Only live in mockup-checks-diff-nav.ts; run order lives in mockup.ts.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import {
  INLINE_ROWS, PANE, PANE_LABEL, PANE_SETTLED, RICH_PATH, getPaneArrow, getRingMarker, listNodes, MARKER_OF, triggerNodeClick,
} from "./mockup-diff-pane.ts";

// ---- task #324 (now #329's pane) ----------------------------------------------------------------
export async function validateDiffPair(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string | null>(RICH_PATH);
  reportCheck("#324 the fixture has a bubble with enough nodes to step a pair through", path !== null);
  if (path === null) {
    return;
  }
  // A plain click is the SINGLE-revision pane: controls hidden, node-step arrows shown.
  await page.evaluate(triggerNodeClick(path, 0));
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#329 a single-node click shows a pane with hidden revision controls",
    await page.evaluate<boolean>(`${getPaneArrow(0)}.hidden && !document.getElementById('dprev').hidden`));

  const baseName = await page.evaluate<string>(triggerNodeClick(path, 0));
  const targetName = await page.evaluate<string>(triggerNodeClick(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#324 shift-click opens the pair pane: its arrows appear and the single arrows go away",
    await page.evaluate<boolean>(`!${getPaneArrow(0)}.hidden && document.getElementById('dprev').hidden`));
  reportCheck("#324 the pane label reads '<base> - <target>'",
    await page.evaluate<string>(PANE_LABEL) === `${baseName} - ${targetName}`,
    { baseName, targetName, shown: await page.evaluate<string>(PANE_LABEL) });
  reportCheck("#324 the lane marks the two ends as base and target",
    await page.evaluate<string | null>(getRingMarker("diff-base")) === baseName
        && await page.evaluate<string | null>(getRingMarker("diff-target")) === targetName);
  reportCheck("#324 the pair's marks REPLACE the single selection's [ ] brackets",
    await page.evaluate<number>(`document.querySelectorAll('.node.found').length`) === 0);

  // Direction comes from axis position, never click order: clicking upwards must match downwards.
  await page.evaluate(triggerNodeClick(path, 3));
  await page.evaluate(triggerNodeClick(path, 0, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#324 the pair's direction comes from the axis, not the click order",
    await page.evaluate<string | null>(getRingMarker("diff-base")) === baseName
        && await page.evaluate<string | null>(getRingMarker("diff-target")) === targetName);
}

// ---- task #324's four arrows, now pane-owned ----------------------------------------------------
export async function validatePairArrows(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string | null>(RICH_PATH);
  if (path === null) {
    return;
  }
  const names = await page.evaluate<string[]>(`${listNodes(path)}.map(${MARKER_OF})`);
  await page.evaluate(triggerNodeClick(path, 0));
  await page.evaluate(triggerNodeClick(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);

  await page.evaluate(`${getPaneArrow(1)}.click()`);
  await page.waitFor(PANE_SETTLED, 10_000);
  // Task 386: the label and the lane rings both follow the pane arrows.
  reportCheck("#324 the base arrow moves the BASE and leaves the target alone",
    await page.evaluate<string>(PANE_LABEL) === `${names[1]} - ${names[3]}`);
  reportCheck("#324 the base arrow moves the base ring onto that node and leaves the target ring",
    await page.evaluate<string | null>(getRingMarker("diff-base")) === names[1]
        && await page.evaluate<string | null>(getRingMarker("diff-target")) === names[3]);
  reportCheck("#324 the pane's meta line follows the moved base",
    await page.evaluate<string>(`${PANE}.querySelector('.dmeta').textContent`) === `base ${names[1]} → target ${names[3]}`);

  await page.evaluate(`${getPaneArrow(2)}.click()`);
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#324 the target arrow moves the TARGET and leaves the base alone",
    await page.evaluate<string>(PANE_LABEL) === `${names[1]} - ${names[2]}`);
  reportCheck("#324 the target arrow moves the target ring onto that node and leaves the base ring",
    await page.evaluate<string | null>(getRingMarker("diff-base")) === names[1]
        && await page.evaluate<string | null>(getRingMarker("diff-target")) === names[2]);

  // Task 329: stepping ONTO the other side is allowed — equal sides read as one revision.
  await page.evaluate(`${getPaneArrow(1)}.click()`);
  await page.waitFor(PANE_SETTLED, 10_000);
  reportCheck("#329 equal sides collapse the label to the one revision",
    await page.evaluate<string>(PANE_LABEL) === names[2]);

  // Walk the base back to the top of the lane; its "previous" arrow must then stop, not wrap.
  await page.evaluate(`${getPaneArrow(0)}.click()`);
  await page.evaluate(`${getPaneArrow(0)}.click()`);
  await page.waitFor(`${getPaneArrow(0)}.disabled`, 10_000);
  reportCheck("#324 an arrow at the lane's end STOPS rather than wrapping round",
    await page.evaluate<string>(PANE_LABEL) === `${names[0]} - ${names[2]}`
        && await page.evaluate<boolean>(`${getPaneArrow(0)}.disabled`));
  reportCheck("#324 the rings sit on the lane's first node and the target's node after the walk",
    await page.evaluate<string | null>(getRingMarker("diff-base")) === names[0]
        && await page.evaluate<string | null>(getRingMarker("diff-target")) === names[2]);
}

// ---- tasks #319/#320: the pane's tools row -------------------------------------------------------
export async function validateDiffTools(page: HeadlessPage): Promise<void> {
  const path = await page.evaluate<string | null>(RICH_PATH);
  if (path === null) {
    return;
  }
  await page.evaluate(triggerNodeClick(path, 0));
  await page.evaluate(triggerNodeClick(path, 3, true));
  await page.waitFor(PANE_SETTLED, 10_000);
  // Task 386: #328 made every pane open INLINE, so the old "opens side-by-side" check now asserts the inline default.
  reportCheck("#319 the pair opens inline, in one column",
    await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 0
        && await page.evaluate<boolean>(
          `${PANE}.querySelector('button[data-mode="inline"]').classList.contains('current')`));
  reportCheck("#319 the two revisions actually differ, so there is a diff to look at",
    await page.evaluate<number>(
      `${PANE}.querySelectorAll('.dfile-body .diff-line.add, .dfile-body .diff-line.del').length`) > 0);

  await page.evaluate(`${PANE}.querySelector('button[data-mode="inline"]').click()`);
  reportCheck("#319 inline is ONE column and paints the current button",
    await page.evaluate<number>(INLINE_ROWS) > 0
        && await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 0
        && await page.evaluate<boolean>(
          `${PANE}.querySelector('button[data-mode="inline"]').classList.contains('current')`));

  const narrow = await page.evaluate<number>(INLINE_ROWS);
  await page.evaluate(`(() => { const f = ${PANE}.querySelector('.dfull-toggle input');
        f.checked = true; f.dispatchEvent(new Event('change')); })()`);
  await page.waitFor(`${INLINE_ROWS} > ${narrow}`, 10_000);
  reportCheck("#320 'full content' WIDENS the same diff rather than replacing it",
    await page.evaluate<number>(INLINE_ROWS) > narrow, { narrow });

  // Back to the state the rest of the run expects.
  await page.evaluate(`(() => { const f = ${PANE}.querySelector('.dfull-toggle input');
        f.checked = false; f.dispatchEvent(new Event('change')); })()`);
  await page.waitFor(`${INLINE_ROWS} === ${narrow}`, 10_000);
  await page.evaluate(`${PANE}.querySelector('button[data-mode="side"]').click()`);
  reportCheck("#319 turning full content off restores the windowed diff",
    await page.evaluate<number>(`${PANE}.querySelectorAll('.dfile-body .diff-cols').length`) === 1);
}
