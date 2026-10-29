// Snapshot drawer checks; split out of mockup-checks-snapshots.ts, run order lives in mockup.ts.

import type { HeadlessPage } from "./cdp.ts";
import { bubbleOf, reportCheck, saveScreenshot } from "./mockup-checks.ts";

export async function validateDrawer(page: HeadlessPage): Promise<void> {
  const open = async (sessionStem: string) => {
    const node = `${bubbleOf("src/util.ts")} i.n-snap[data-session-file$="${sessionStem}.jsonl"][data-version="2"]`;
    await page.evaluate(`document.querySelector('${node}').click()`);
    await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, 5_000);
    // The title, body and session flash all land after an async fetch.
    await page.waitFor(`document.getElementById('dpath').textContent.includes(' - ')
        && !document.getElementById('dbody').textContent.includes('loading…')`, 5_000);
    return page.evaluate<{ head: string; meta: string; body: string }>(
      `({ head: document.getElementById('dpath').textContent,
            meta: document.getElementById('dmeta').textContent,
            body: document.getElementById('dbody').textContent })`);
  };
  const early = await open("b21d84c5");
  reportCheck("#305 the header reads '<file> Snapshot - <title at that line range>'",
    early.head === "util.ts Snapshot - dispatch through one table", early.head);
  const late = await open("d4a06b8f");
  reportCheck("#305 the other @v2 resolves its OWN session's title",
    late.head === "util.ts Snapshot - cover the error branch, take notes", late.head);
  reportCheck("#300 two same-named @v2 snapshots hold DIFFERENT bytes", early.body !== late.body,
    { early: early.body.slice(0, 80), late: late.body.slice(0, 80) });
  reportCheck("#305 the drawer names the owning session", late.meta.includes("d4a06b8f.jsonl"), late.meta);
  const flashed = await page.evaluate<string | null>(
    `document.querySelector('.session-item.flash')?.dataset.file ?? null`);
  reportCheck("#305 clicking a snapshot node flashes its JSONL", flashed === "d4a06b8f.jsonl", flashed);
  // Task 386: the page has no `.node.hot:not(.found):hover` rule.
  // reportCheck("a selected node shows no hover ring",
  //   await page.evaluate<boolean>(`[...document.styleSheets[0].cssRules]
  //           .some(r => r.selectorText === '.node.hot:not(.found):hover')`));
  await saveScreenshot(page, "04-drawer");
}
