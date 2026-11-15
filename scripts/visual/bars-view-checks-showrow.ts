// Bars view checks for the show row: ticking a kind only hides or shows dots.

import { type HeadlessPage } from "./cdp.ts";
import { countShownElements } from "./bars-view-page-reads.ts";
import { reportCheck } from "./mockup-checks.ts";

type ShowRowSnapshot = { visibleCommitDots: number; visibleBlocks: number; marks: number; requests: number };

function buildKindBoxExpression(kind: string): string {
    return `document.querySelector('#timelineViewControls input[data-kind="${kind}"]')`;
}

async function readShowRowSnapshot(page: HeadlessPage): Promise<ShowRowSnapshot> {
    return {
        visibleCommitDots: await countShownElements(page, ".BarDot.grp-commit"),
        visibleBlocks: await countShownElements(page, ".barsHistoryBlock"),
        marks: await page.evaluate<number>(`document.querySelectorAll('.barsPlusSign, .barsMinusSign, .barsMovedAwaySign').length`),
        requests: await page.evaluate<number>("window.__barsReposRequests"),
    };
}

async function checkEditAndScriptRunStartUnticked(page: HeadlessPage): Promise<void> {
    for (const kind of ["edit", "script-run"]) {
        const isChecked = await page.evaluate<boolean>(`${buildKindBoxExpression(kind)}.checked`);
        reportCheck(`show row: ${kind} starts unticked`, !isChecked);
    }
    reportCheck("show row: no edit dot is shown at the start", await countShownElements(page, ".BarDot.grp-edit") === 0);
}

async function checkUntickingCommitOnlyHidesCommitDots(page: HeadlessPage): Promise<void> {
    const before = await readShowRowSnapshot(page);
    reportCheck("show row: commit dots are shown before the untick", before.visibleCommitDots > 0, before);
    await page.evaluate(`${buildKindBoxExpression("commit")}.click()`);
    const after = await readShowRowSnapshot(page);
    reportCheck("show row: unticking commit hides every commit dot", after.visibleCommitDots === 0, after);
    reportCheck("show row: unticking commit leaves the visible history blocks unchanged", after.visibleBlocks === before.visibleBlocks, { before, after });
    reportCheck("show row: unticking commit leaves the signs unchanged", after.marks === before.marks, { before, after });
    reportCheck("show row: unticking commit sends no new inverse repos request", after.requests === before.requests, { before, after });
    await page.evaluate(`${buildKindBoxExpression("commit")}.click()`);
}

async function checkTickingEditShowsEditDots(page: HeadlessPage): Promise<void> {
    const requestsBefore = await page.evaluate<number>("window.__barsReposRequests");
    await page.evaluate(`${buildKindBoxExpression("edit")}.click()`);
    reportCheck("show row: ticking edit shows the edit dots", await countShownElements(page, ".BarDot.grp-edit") > 0);
    const requestsAfter = await page.evaluate<number>("window.__barsReposRequests");
    reportCheck("show row: ticking edit sends no inverse repos request", requestsAfter === requestsBefore, { requestsBefore, requestsAfter });
    await page.evaluate(`${buildKindBoxExpression("edit")}.click()`);
}

export async function executeShowRowChecks(page: HeadlessPage): Promise<void> {
    await checkEditAndScriptRunStartUnticked(page);
    await checkUntickingCommitOnlyHidesCommitDots(page);
    await checkTickingEditShowsEditDots(page);
}
