// Small page reads and actions shared by the Bars view checks.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMITS } from "../../src/viewer_api_layer1_fixture_data.ts";
import { type HeadlessPage, type MouseHeadlessPage } from "./cdp.ts";

const TICK_LIST_EXPRESSION = `[...document.querySelectorAll('#timelineRulerComponent .tick')].reverse()`;
const TICK_LABEL_PATTERN = /^(\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3}) \(\d+\)$/;

export function countElements(page: HeadlessPage, selector: string): Promise<number> {
    return page.evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

export function countShownElements(page: HeadlessPage, selector: string): Promise<number> {
    return page.evaluate<number>(`[...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((element) => getComputedStyle(element).display !== 'none').length`);
}

export function readFirstComputedStyle(page: HeadlessPage, selector: string, property: string): Promise<string> {
    return page.evaluate<string>(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (element === null) throw new Error('no element: ' + ${JSON.stringify(selector)});
        return getComputedStyle(element)[${JSON.stringify(property)}];
    })()`);
}

export function buildFileRowExpression(path: string): string {
    return `[...document.querySelectorAll('.barsFileRow')]
        .find((row) => row.querySelector('.barsFilePath').textContent === ${JSON.stringify(path)})`;
}

export function countInFileRow(page: HeadlessPage, path: string, selector: string): Promise<number> {
    return page.evaluate<number>(`${buildFileRowExpression(path)}.querySelectorAll(${JSON.stringify(selector)}).length`);
}

export function readFileRowValue(page: HeadlessPage, path: string, selector: string, property: "textContent" | "title"): Promise<string> {
    return page.evaluate<string>(`${buildFileRowExpression(path)}.querySelector(${JSON.stringify(selector)})[${JSON.stringify(property)}]`);
}

export function readTickTexts(page: HeadlessPage): Promise<string[]> {
    return page.evaluate<string[]>(`${TICK_LIST_EXPRESSION}.map((tick) => tick.childNodes[0].textContent)`);
}

export function readSelectedTickIndexes(page: HeadlessPage): Promise<number[]> {
    return page.evaluate<number[]>(`${TICK_LIST_EXPRESSION}.flatMap((tick, index) => tick.classList.contains('barsSelected') ? [index] : [])`);
}

export function readFixtureYear(): number {
    const firstCommit = COMMITS[0];
    if (firstCommit === undefined) {
        throw new Error("the fixture has no commit to read a year from");
    }
    return new Date(firstCommit.at).getUTCFullYear();
}

// A row label is "MM-DD HH:MM:SS.mmm (events)" in UTC: the row's oldest instant, which the model maps back to that same row.
export function parseTickLabelToInstant(tickText: string, year: number): string {
    const match = TICK_LABEL_PATTERN.exec(tickText);
    if (match === null) {
        throw new Error(`tick text is not a ruler label: ${tickText}`);
    }
    return `${year}-${match[1]}T${match[2]}Z`;
}

export async function readRulerRowTimes(page: HeadlessPage): Promise<string[]> {
    const tickTexts = await readTickTexts(page);
    const year = readFixtureYear();
    return tickTexts.map((tickText) => parseTickLabelToInstant(tickText, year));
}

export async function clickTickWithMouse(page: MouseHeadlessPage, newestIndex: number): Promise<void> {
    const centre = await page.evaluate<{ x: number; y: number }>(`(() => {
        const tick = ${TICK_LIST_EXPRESSION}[${newestIndex}];
        tick.scrollIntoView({ block: 'center' });
        const box = tick.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    await page.dispatchMouse("mouseMoved", centre.x, centre.y);
    await page.dispatchMouse("mousePressed", centre.x, centre.y);
    await page.dispatchMouse("mouseReleased", centre.x, centre.y);
}

export async function saveBarsScreenshot(page: HeadlessPage, outDir: string, name: string): Promise<void> {
    writeFileSync(join(outDir, `bars-view-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
}
