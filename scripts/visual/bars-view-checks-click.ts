// Bars view checks for clicks: real tick click, dot click, shift-click on a dot, events button.

import { waitMilliseconds, type MouseHeadlessPage } from "./cdp.ts";
import { FAKE_PLAIN_PATH } from "./bars-view-fake-data.ts";
import { buildFileRowExpression, clickTickWithMouse, countShownElements, readSelectedTickIndexes, readTickTexts, saveBarsScreenshot } from "./bars-view-page-reads.ts";
import { reportCheck } from "./mockup-checks.ts";

const FILL_TRANSITION_WAIT_MS = 700;
const CHANGED_FILE_FILL_WIDTH = `[...document.querySelectorAll('.barsFileRow:not(.barsFoldedRow) .barsFill')]
    .map((fill) => parseFloat(getComputedStyle(fill).width))`;

export async function executeTickClickChecks(page: MouseHeadlessPage, outDir: string): Promise<void> {
    await clickTickWithMouse(page, 3);
    await waitMilliseconds(FILL_TRANSITION_WAIT_MS);
    const selectedIndexes = await readSelectedTickIndexes(page);
    reportCheck("tick click: only the fourth newest tick has barsSelected", JSON.stringify(selectedIndexes) === "[3]", selectedIndexes);
    const blocksAttribute = await page.evaluate<string>(`document.getElementById('barsRows').dataset.blocks`);
    reportCheck("tick click: #barsRows[data-blocks] is hidden", blocksAttribute === "hidden", blocksAttribute);
    reportCheck("tick click: every .barsHistoryBlock has display none", await countShownElements(page, ".barsHistoryBlock") === 0);
    const fillWidths = await page.evaluate<number[]>(CHANGED_FILE_FILL_WIDTH);
    reportCheck("tick click: the fill width of a changed file is greater than 0", fillWidths.some((width) => width > 0), fillWidths);
    await saveBarsScreenshot(page, outDir, "02-after-tick-click");
}

// Fires a click with the shift key state on the first commit dot of the file whose title contains titleEnd (any when null); a dot title ends with the row text "MM-DD HH:MM:SS.mmm (n)".
async function dispatchCommitDotClick(page: MouseHeadlessPage, path: string, titleEnd: string | null, isShiftKey: boolean): Promise<void> {
    await page.evaluate(`(() => {
        const dots = [...${buildFileRowExpression(path)}.querySelectorAll('.BarDot.grp-commit')];
        const dot = dots.find((candidate) => ${JSON.stringify(titleEnd)} === null || candidate.title.includes(${JSON.stringify(titleEnd)}));
        if (dot === undefined) throw new Error('no commit dot with title containing ' + ${JSON.stringify(titleEnd)});
        dot.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${isShiftKey} }));
    })()`);
}

async function checkPlainClickOpensDetails(page: MouseHeadlessPage): Promise<void> {
    await dispatchCommitDotClick(page, FAKE_PLAIN_PATH, null, false);
    const isOpen = await page.evaluate<boolean>(`document.getElementById('detailsPaneContainer').classList.contains('open')`);
    reportCheck("dot click: #detailsPaneContainer has class open", isOpen);
    const detailsPath = await page.evaluate<string>(`document.getElementById('dpath').textContent`);
    reportCheck("dot click: #dpath equals the file path", detailsPath === FAKE_PLAIN_PATH, detailsPath);
}

async function checkShiftClickSelectsTick(page: MouseHeadlessPage): Promise<void> {
    const tickTexts = await readTickTexts(page);
    await dispatchCommitDotClick(page, FAKE_PLAIN_PATH, tickTexts[1] ?? "", true);
    const selectedIndexes = await readSelectedTickIndexes(page);
    reportCheck("shift-click on a dot: only the tick that holds the time of that dot has barsSelected", JSON.stringify(selectedIndexes) === "[1]", selectedIndexes);
}

export async function executeDotClickChecks(page: MouseHeadlessPage): Promise<void> {
    await checkPlainClickOpensDetails(page);
    await checkShiftClickSelectsTick(page);
}

export async function executeEventsButtonCheck(page: MouseHeadlessPage): Promise<void> {
    await page.evaluate(`document.getElementById('barsEventsViewButton').click()`);
    const hasClass = await page.evaluate<boolean>(`document.getElementById('barsTimelineArea').classList.contains('eventsInBar')`);
    reportCheck("events button: #barsTimelineArea has class eventsInBar", hasClass);
}
