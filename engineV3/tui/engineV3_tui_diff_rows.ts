// The rows of the side-by-side diff in the View File box: the newer text on the left, the marker text on the right.

import { DiffRowKind } from "../../src/structures/vocabulary.ts";

export type DiffRow = { kind: DiffRowKind; newerText: string | undefined; markerText: string | undefined };
export type DiffView = { rows: DiffRow[]; emptyText: string };

const NO_NEWER_STATE_TEXT = "no newer state to compare";
const NO_STORED_TEXT = "no stored text at this time";

function splitTextIntoLines(text: string): string[] {
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

// ponytail: the table is lines x lines; a file of 5000 lines needs 25 million cells. Use a Myers diff if files get that big.
function buildLongestCommonLengths(newerLines: string[], markerLines: string[]): number[][] {
    const lengths = Array.from({ length: newerLines.length + 1 }, () => new Array<number>(markerLines.length + 1).fill(0));
    for (let newerIndex = newerLines.length - 1; newerIndex >= 0; newerIndex--) {
        for (let markerIndex = markerLines.length - 1; markerIndex >= 0; markerIndex--) {
            if (newerLines[newerIndex] === markerLines[markerIndex]) {
                lengths[newerIndex]![markerIndex] = lengths[newerIndex + 1]![markerIndex + 1]! + 1;
            } else {
                lengths[newerIndex]![markerIndex] = Math.max(lengths[newerIndex + 1]![markerIndex]!, lengths[newerIndex]![markerIndex + 1]!);
            }
        }
    }
    return lengths;
}

// Pairs the lines of one block of changes: the first lines side by side as changed rows, the rest alone.
function pairChangedBlock(newerBlock: string[], markerBlock: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const pairCount = Math.max(newerBlock.length, markerBlock.length);
    for (let index = 0; index < pairCount; index++) {
        const newerText = newerBlock[index];
        const markerText = markerBlock[index];
        if (newerText === undefined) {
            rows.push({ kind: DiffRowKind.OnlyMarker, newerText, markerText });
        } else if (markerText === undefined) {
            rows.push({ kind: DiffRowKind.OnlyNewer, newerText, markerText });
        } else {
            rows.push({ kind: DiffRowKind.Changed, newerText, markerText });
        }
    }
    return rows;
}

export function computeDiffRows(newerText: string, markerText: string): DiffRow[] {
    const newerLines = splitTextIntoLines(newerText);
    const markerLines = splitTextIntoLines(markerText);
    const lengths = buildLongestCommonLengths(newerLines, markerLines);
    const rows: DiffRow[] = [];
    let newerBlock: string[] = [];
    let markerBlock: string[] = [];
    let newerIndex = 0;
    let markerIndex = 0;
    while (newerIndex < newerLines.length || markerIndex < markerLines.length) {
        const newerLine = newerLines[newerIndex];
        const markerLine = markerLines[markerIndex];
        if (newerLine === undefined) {
            markerBlock.push(markerLine!);
            markerIndex++;
        } else if (markerLine === undefined) {
            newerBlock.push(newerLine);
            newerIndex++;
        } else if (newerLine === markerLine) {
            rows.push(...pairChangedBlock(newerBlock, markerBlock));
            newerBlock = [];
            markerBlock = [];
            rows.push({ kind: DiffRowKind.Same, newerText: newerLine, markerText: markerLine });
            newerIndex++;
            markerIndex++;
        } else if (lengths[newerIndex + 1]![markerIndex]! >= lengths[newerIndex]![markerIndex + 1]!) {
            newerBlock.push(newerLine);
            newerIndex++;
        } else {
            markerBlock.push(markerLine);
            markerIndex++;
        }
    }
    rows.push(...pairChangedBlock(newerBlock, markerBlock));
    return rows;
}

export function computeDiffView(markerText: string | undefined, newerText: string | undefined): DiffView {
    if (markerText === undefined) {
        return { rows: [], emptyText: NO_STORED_TEXT };
    }
    if (newerText === undefined) {
        return { rows: [], emptyText: NO_NEWER_STATE_TEXT };
    }
    return { rows: computeDiffRows(newerText, markerText), emptyText: NO_STORED_TEXT };
}
