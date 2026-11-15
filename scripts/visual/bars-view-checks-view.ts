// Bars view checks for the page around the bars: hidden parts, the one real ruler, the slider, the failure path.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { FAKE_ERROR_TEXT } from "./bars-view-fake-data.ts";
import { countElements, countShownElements, readFirstComputedStyle, saveBarsScreenshot } from "./bars-view-page-reads.ts";
import { reportCheck } from "./mockup-checks.ts";

const SLIDER_BARS = "0";
const SLIDER_BUBBLES = "1";
const SLIDER_SETTLE_MS = 1000;
const ERROR_SETTLE_MS = 1000;

export async function checkBarsViewHidesTheBubblePage(page: HeadlessPage): Promise<void> {
    for (const selector of [".minimapComponent", ".zoombar", "#reverse-toggle"]) {
        const elementCount = await countElements(page, selector);
        const shownCount = await countShownElements(page, selector);
        reportCheck(`Bars view: ${selector} exists and has display none`, elementCount > 0 && shownCount === 0, { elementCount, shownCount });
    }
    reportCheck("Bars view: #timelineContainer is visible", await countShownElements(page, "#timelineContainer") === 1);
}

async function checkRulerHasSize(page: HeadlessPage, selector: string, viewName: string): Promise<void> {
    const display = await readFirstComputedStyle(page, selector, "display");
    reportCheck(`${viewName}: ${selector} has a display that is not none`, display !== "none", display);
    const size = await page.evaluate<{ width: number; height: number }>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
    reportCheck(`${viewName}: ${selector} has a non-zero size`, size.width > 0 && size.height > 0, size);
}

export async function checkRealRulerStays(page: HeadlessPage, viewName: string): Promise<void> {
    await checkRulerHasSize(page, ".timelineRulerContainer", viewName);
    await checkRulerHasSize(page, "#timelineRulerComponent", viewName);
    reportCheck(`${viewName}: exactly one element has id timelineRulerComponent`, await countElements(page, "[id='timelineRulerComponent']") === 1);
    reportCheck(`${viewName}: no second ruler component`, await countElements(page, ".timelineRulerComponent") === 1);
    reportCheck(`${viewName}: no second ruler container`, await countElements(page, ".timelineRulerContainer") === 1);
}

export async function checkRulerContainerScrolls(page: HeadlessPage): Promise<void> {
    const overflowY = await readFirstComputedStyle(page, ".timelineRulerContainer", "overflowY");
    reportCheck("Bars view: the ruler container scrolls (overflow-y auto or scroll)", overflowY === "auto" || overflowY === "scroll", overflowY);
}

async function moveSlider(page: HeadlessPage, value: string): Promise<void> {
    await page.evaluate(`(() => {
        const slider = document.getElementById('barsViewSliderInput');
        slider.value = ${JSON.stringify(value)};
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitMilliseconds(SLIDER_SETTLE_MS);
}

export async function executeSliderToBubblesChecks(page: HeadlessPage, outDir: string): Promise<void> {
    await moveSlider(page, SLIDER_BUBBLES);
    const sizedFileboxCount = await page.evaluate<number>(`[...document.querySelectorAll('.filebox')]
        .filter((box) => box.getBoundingClientRect().width > 0 && box.getBoundingClientRect().height > 0).length`);
    reportCheck("slider at 1: the bubble stage shows (.filebox elements have a size)", sizedFileboxCount > 0, sizedFileboxCount);
    const barsDisplay = await readFirstComputedStyle(page, "#barsViewComponent", "display");
    reportCheck("slider at 1: #barsViewComponent has display none", barsDisplay === "none", barsDisplay);
    await checkRealRulerStays(page, "Bubbles view");
    await saveBarsScreenshot(page, outDir, "03-bubbles-view");
    await moveSlider(page, SLIDER_BARS);
}

export async function executeFailureChecks(page: HeadlessPage): Promise<void> {
    await page.evaluate(`(window.__barsFakeMode = 'error', window.__barsLoadingLog = [], window.__barsReposRequests = 0, true)`);
    await page.evaluate(`document.getElementById('load').click()`);
    await page.waitFor("window.__barsReposRequests >= 1", 30_000);
    await waitMilliseconds(ERROR_SETTLE_MS);
    const loadingLog = await page.evaluate<boolean[]>("window.__barsLoadingLog");
    reportCheck(`failure path (${FAKE_ERROR_TEXT}): the loading class was set during the load`, loadingLog.includes(true), loadingLog);
    const isStillLoading = await page.evaluate<boolean>(`document.getElementById('timelineRulerComponent').classList.contains('barsRulerLoading')`);
    reportCheck("failure path: the loading class is gone after the error line", !isStillLoading);
    const statusLineText = await page.evaluate<string>(`document.getElementById('barsStatusLine').textContent`);
    reportCheck("failure path: #barsStatusLine starts with ==> Change history did not load:", statusLineText.startsWith("==> Change history did not load:"), statusLineText);
    const headerLineText = await page.evaluate<string>(`document.getElementById('barsHeaderLine').textContent`);
    console.log(`header after failed load: ${headerLineText}`);
}
