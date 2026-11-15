// Bars view checks while the history loads and right after it has loaded.

import type { InverseRepoFileWire } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { type MouseHeadlessPage } from "./cdp.ts";
import { FAKE_OTHER_STATUS_TEXT, FAKE_SECOND_LOG_FILE, countExpectedDots } from "./bars-view-fake-data.ts";
import { armStreamGate, releaseStreamLines } from "./bars-view-fake-fetch.ts";
import { clickTickWithMouse, countElements, countShownElements, readFirstComputedStyle, readSelectedTickIndexes, saveBarsScreenshot } from "./bars-view-page-reads.ts";
import { reportCheck } from "./mockup-checks.ts";

const STAGE_TEXTS = [
    "No reconstruction history yet", "Loading commits", "Loading snapshots", "Loading full reads",
    "Loading edits", "Loading script replays", "Change history is complete",
];
const WHEN_BEFORE_RESULT = "mid-load, before the result line";
const WHEN_DURING_REVEAL = "mid-load, during the staged reveal";
const RULER_IS_LOADING = `document.getElementById('timelineRulerComponent').classList.contains('barsRulerLoading')`;

function buildExpectedStatusTexts(fileCount: number): string[] {
    const fileDoneTexts = Array.from({ length: fileCount }, (_, index) => `${index + 1} of ${fileCount} files done`);
    return ["Reading all session logs (one time)", FAKE_OTHER_STATUS_TEXT, ...fileDoneTexts, ...STAGE_TEXTS];
}

function removeRepeatedNeighbours(texts: string[]): string[] {
    return texts.filter((text, index) => text !== texts[index - 1]);
}

async function checkRealMouseClickIsIgnored(page: MouseHeadlessPage, when: string): Promise<void> {
    const selectedBefore = await readSelectedTickIndexes(page);
    const clicksBefore = await page.evaluate<number>("window.__barsTickClicks");
    await clickTickWithMouse(page, 3);
    const selectedAfter = await readSelectedTickIndexes(page);
    const clicksAfter = await page.evaluate<number>("window.__barsTickClicks");
    reportCheck(`${when}: a real mouse click on the fourth newest tick reaches no tick`, clicksAfter === clicksBefore, { clicksBefore, clicksAfter });
    reportCheck(`${when}: that click leaves barsSelected where it was`, JSON.stringify(selectedAfter) === JSON.stringify(selectedBefore), { selectedBefore, selectedAfter });
}

async function checkRulerIsLoading(page: MouseHeadlessPage, when: string): Promise<void> {
    reportCheck(`${when}: the ruler has class barsRulerLoading`, await page.evaluate<boolean>(RULER_IS_LOADING));
    const pointerEvents = await readFirstComputedStyle(page, "#timelineRulerComponent .tick", "pointerEvents");
    reportCheck(`${when}: the computed pointer-events of the first tick is none`, pointerEvents === "none", pointerEvents);
}

async function checkStatusTextsInOrder(page: MouseHeadlessPage, fileCount: number): Promise<void> {
    const statusLog = await page.evaluate<string[]>("window.__barsStatusLog");
    const seenTexts = removeRepeatedNeighbours(statusLog);
    reportCheck("load: #barsStatusLine showed each stage text in order", JSON.stringify(seenTexts) === JSON.stringify(buildExpectedStatusTexts(fileCount)), seenTexts);
}

async function checkRowsAndDotsCounts(page: MouseHeadlessPage, files: InverseRepoFileWire[]): Promise<void> {
    const rowCount = await countElements(page, ".barsFileRow");
    reportCheck("after load: .barsFileRow count equals the file count", rowCount === files.length, { rowCount, fileCount: files.length });
    const dotCount = await countElements(page, ".BarDot");
    reportCheck("after load: .BarDot count equals the commit count (a gone file's DiskNow draws no dot)", dotCount === countExpectedDots(files), { dotCount });
}

async function checkRevealedState(page: MouseHeadlessPage, fileCount: number): Promise<void> {
    const blocksAttribute = await page.evaluate<string>(`document.getElementById('barsRows').dataset.blocks`);
    reportCheck("after load: #barsRows[data-blocks] is shown", blocksAttribute === "shown", blocksAttribute);
    const revealedBlockCount = await countShownElements(page, ".barsHistoryBlock.blockRevealed");
    reportCheck("after load: revealed history blocks have display block", revealedBlockCount > 0, revealedBlockCount);
    reportCheck("after load: the loading class is gone", !(await page.evaluate<boolean>(RULER_IS_LOADING)));
    const pointerEvents = await readFirstComputedStyle(page, "#timelineRulerComponent .tick", "pointerEvents");
    reportCheck("after load: the computed pointer-events of the first tick is not none", pointerEvents !== "none", pointerEvents);
    await checkFoldedList(page, fileCount);
}

async function checkFoldedList(page: MouseHeadlessPage, fileCount: number): Promise<void> {
    const foldedDisplay = await readFirstComputedStyle(page, ".barsFoldedList", "display");
    reportCheck("after load: .barsFoldedList is visible", foldedDisplay !== "none", foldedDisplay);
    const foldLineText = await page.evaluate<string>(`document.querySelector('#barsRowList .barsFoldLine').textContent`);
    const foldLinePattern = new RegExp(`^(==>\\s*)?${fileCount} files`);
    reportCheck("after load: .barsFoldLine text starts with the file count", foldLinePattern.test(foldLineText), foldLineText);
}

async function startGatedLoad(page: MouseHeadlessPage, lines: string[]): Promise<void> {
    await armStreamGate(page, lines);
    await page.evaluate(`document.getElementById('load').click()`);
    await page.waitFor("window.__barsReposRequests >= 1", 30_000);
}

async function checkLogFileLineWhileLogsAreRead(page: MouseHeadlessPage): Promise<void> {
    await releaseStreamLines(page, 2);
    const logFileLineText = await page.evaluate<string>(`document.getElementById('barsLogFileLine').textContent`);
    reportCheck("log read: #barsLogFileLine shows the second log file name", logFileLineText === FAKE_SECOND_LOG_FILE, logFileLineText);
    const logFileLineDisplay = await readFirstComputedStyle(page, "#barsLogFileLine", "display");
    reportCheck("log read: #barsLogFileLine is visible", logFileLineDisplay !== "none", logFileLineDisplay);
    const statusText = await page.evaluate<string>(`document.getElementById('barsStatusLine').textContent`);
    reportCheck("log read: #barsStatusLine still shows the reading text", statusText.endsWith("Reading all session logs (one time)"), statusText);
}

async function checkLogFileLineIsHiddenAfterLoad(page: MouseHeadlessPage): Promise<void> {
    const isHidden = await page.evaluate<boolean>(`document.getElementById('barsLogFileLine').hidden`);
    reportCheck("after load: #barsLogFileLine is hidden", isHidden);
}

async function checkLoadingBeforeResult(page: MouseHeadlessPage, lines: string[]): Promise<void> {
    await releaseStreamLines(page, lines.length - 3);
    await checkRulerIsLoading(page, WHEN_BEFORE_RESULT);
    await checkRealMouseClickIsIgnored(page, WHEN_BEFORE_RESULT);
}

async function checkLoadingDuringReveal(page: MouseHeadlessPage): Promise<void> {
    await releaseStreamLines(page, 1);
    await page.waitFor(`document.querySelector('.tick.barsSelected') !== null`, 10_000);
    await checkRulerIsLoading(page, WHEN_DURING_REVEAL);
    const selectedIndexes = await readSelectedTickIndexes(page);
    reportCheck(`${WHEN_DURING_REVEAL}: the newest tick has barsSelected`, JSON.stringify(selectedIndexes) === "[0]", selectedIndexes);
    await checkRealMouseClickIsIgnored(page, WHEN_DURING_REVEAL);
}

export async function executeLoadChecks(page: MouseHeadlessPage, files: InverseRepoFileWire[], lines: string[], outDir: string): Promise<void> {
    await startGatedLoad(page, lines);
    await checkLogFileLineWhileLogsAreRead(page);
    await checkLoadingBeforeResult(page, lines);
    await checkLoadingDuringReveal(page);
    await page.waitFor(`!(${RULER_IS_LOADING})`, 20_000);
    await checkStatusTextsInOrder(page, files.length);
    await checkLogFileLineIsHiddenAfterLoad(page);
    await checkRowsAndDotsCounts(page, files);
    await checkRevealedState(page, files.length);
    await saveBarsScreenshot(page, outDir, "01-after-load");
}
