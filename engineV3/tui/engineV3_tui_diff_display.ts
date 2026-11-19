// The display lines of the side-by-side diff: each side numbered, colored by token and wrapped; both sides of a row have the same height.

import type { DiffRowKind } from "../../src/structures/vocabulary.ts";
import { computeDiffView, type DiffRow } from "./engineV3_tui_diff_rows.ts";
import { buildFileViewLines, highlightFileLines, type ColoredPiece, type FileViewLine } from "./engineV3_tui_file_view_text.ts";

const BOX_BORDER_COLUMNS = 2;
const NUMBER_GAP_COLUMNS = 1;
const BLANK_LINE: FileViewLine = { lineNumber: undefined, pieces: [] };

export type DiffDisplayLine = { kind: DiffRowKind; newer: FileViewLine; marker: FileViewLine };
export type DiffDisplay = { lines: DiffDisplayLine[]; emptyText: string };

function computeContentWidth(sideColumns: number, fileLineCount: number): number {
    const lineNumberWidth = String(fileLineCount).length;
    return Math.max(1, sideColumns - BOX_BORDER_COLUMNS - lineNumberWidth - NUMBER_GAP_COLUMNS);
}

function wrapFileLine(fileLine: ColoredPiece[], lineNumber: number, contentWidth: number): FileViewLine[] {
    const wrappedLines = buildFileViewLines([fileLine], contentWidth);
    wrappedLines[0]!.lineNumber = lineNumber;
    return wrappedLines;
}

function buildDiffDisplayLines(rows: DiffRow[], newerFileLines: ColoredPiece[][], markerFileLines: ColoredPiece[][], newerColumns: number, markerColumns: number): DiffDisplayLine[] {
    const newerContentWidth = computeContentWidth(newerColumns, newerFileLines.length);
    const markerContentWidth = computeContentWidth(markerColumns, markerFileLines.length);
    const displayLines: DiffDisplayLine[] = [];
    let newerFileIndex = 0;
    let markerFileIndex = 0;
    for (const row of rows) {
        let newerWrapped: FileViewLine[] = [];
        let markerWrapped: FileViewLine[] = [];
        if (row.newerText !== undefined) {
            newerWrapped = wrapFileLine(newerFileLines[newerFileIndex]!, newerFileIndex + 1, newerContentWidth);
            newerFileIndex++;
        }
        if (row.markerText !== undefined) {
            markerWrapped = wrapFileLine(markerFileLines[markerFileIndex]!, markerFileIndex + 1, markerContentWidth);
            markerFileIndex++;
        }
        const height = Math.max(newerWrapped.length, markerWrapped.length);
        for (let index = 0; index < height; index++) {
            displayLines.push({ kind: row.kind, newer: newerWrapped[index] ?? BLANK_LINE, marker: markerWrapped[index] ?? BLANK_LINE });
        }
    }
    return displayLines;
}

// The newer side is the left half of the columns; the marker side is the right half.
export function computeDiffDisplay(markerText: string | undefined, newerText: string | undefined, language: string | undefined, columns: number): DiffDisplay {
    const view = computeDiffView(markerText, newerText);
    if (view.rows.length === 0) {
        return { lines: [], emptyText: view.emptyText };
    }
    const newerColumns = Math.floor(columns / 2);
    const lines = buildDiffDisplayLines(view.rows, highlightFileLines(newerText!, language), highlightFileLines(markerText!, language), newerColumns, columns - newerColumns);
    return { lines, emptyText: view.emptyText };
}
