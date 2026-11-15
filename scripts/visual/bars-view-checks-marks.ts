// Bars view checks for the signs and dots of the deleted, moved-away and created fake files.

import type { InverseRepoFileWire } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { type HeadlessPage } from "./cdp.ts";
import { FAKE_CREATED_PATH, FAKE_DELETED_PATH, FAKE_MOVED_DESTINATION, FAKE_MOVED_PATH } from "./bars-view-fake-data.ts";
import { buildFileRowExpression, countInFileRow, readFileRowValue } from "./bars-view-page-reads.ts";
import { reportCheck } from "./mockup-checks.ts";

async function checkGoneFile(page: HeadlessPage): Promise<void> {
    const barLeft = await page.evaluate<number>(`parseFloat(getComputedStyle(${buildFileRowExpression(FAKE_DELETED_PATH)}.querySelector('.FileReconstructionProgressBar')).left)`);
    reportCheck("gone file: its .FileReconstructionProgressBar has a computed left greater than 0", barLeft > 0, barLeft);
    reportCheck("gone file: one .barsMinusSign", await countInFileRow(page, FAKE_DELETED_PATH, ".barsMinusSign") === 1);
    reportCheck("gone file: one .BarDot.bd-deleted", await countInFileRow(page, FAKE_DELETED_PATH, ".BarDot.bd-deleted") === 1);
    reportCheck("gone file: no .BarDot.bd-disk", await countInFileRow(page, FAKE_DELETED_PATH, ".BarDot.bd-disk") === 0);
}

async function checkRemovedAndMovedSigns(page: HeadlessPage): Promise<void> {
    const minusText = await readFileRowValue(page, FAKE_DELETED_PATH, ".barsMinusSign", "textContent");
    reportCheck("removed commit: the .barsMinusSign reads -", minusText === "-", minusText);
    reportCheck("moved-away commit: one .barsMovedAwaySign", await countInFileRow(page, FAKE_MOVED_PATH, ".barsMovedAwaySign") === 1);
    const arrowText = await readFileRowValue(page, FAKE_MOVED_PATH, ".barsMovedAwaySign", "textContent");
    reportCheck("moved-away commit: the sign reads ←", arrowText === "←", arrowText);
    const arrowTitle = await readFileRowValue(page, FAKE_MOVED_PATH, ".barsMovedAwaySign", "title");
    reportCheck("moved-away commit: the title names the destination", arrowTitle.includes(FAKE_MOVED_DESTINATION), arrowTitle);
}

async function checkCreatedFile(page: HeadlessPage): Promise<void> {
    reportCheck("created file: one .barsPlusSign", await countInFileRow(page, FAKE_CREATED_PATH, ".barsPlusSign") === 1);
    reportCheck("created file: one .BarDot.bd-created", await countInFileRow(page, FAKE_CREATED_PATH, ".BarDot.bd-created") === 1);
}

async function checkAtMostOneCreatedDotPerFile(page: HeadlessPage, files: InverseRepoFileWire[]): Promise<void> {
    for (const file of files) {
        const createdDotCount = await countInFileRow(page, file.file, ".BarDot.bd-created");
        reportCheck(`${file.file}: at most one .BarDot.bd-created`, createdDotCount <= 1, createdDotCount);
    }
}

export async function executeMarkChecks(page: HeadlessPage, files: InverseRepoFileWire[]): Promise<void> {
    await checkGoneFile(page);
    await checkRemovedAndMovedSigns(page);
    await checkCreatedFile(page);
    await checkAtMostOneCreatedDotPerFile(page, files);
}
