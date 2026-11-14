// Terminal display of the inverse-repo build: one line and one bar for each file.

import type { ProgressSink } from "../src/parse/loadTranscript.ts";

export const FILE_NAME_WIDTH = 44;
export const BAR_CELLS = 24;

export type TerminalBarRow = { fileName: string; fraction: number; countText: string };

export type TerminalBarStream = { isTTY?: boolean; write(text: string): unknown };

export function formatFileNameToWidth(fileName: string, width: number): string {
    if (fileName.length > width) {
        return "…" + fileName.slice(fileName.length - (width - 1));
    }
    return fileName.padEnd(width);
}

export function buildBarText(fraction: number): string {
    const filledCells = Math.round(fraction * BAR_CELLS);
    return "[" + "█".repeat(filledCells) + "░".repeat(BAR_CELLS - filledCells) + "]";
}

export function buildFileLine(row: TerminalBarRow): string {
    return `${formatFileNameToWidth(row.fileName, FILE_NAME_WIDTH)} ${buildBarText(row.fraction)} ${row.countText}`.trimEnd();
}

export function createTerminalBarsSink(stream: TerminalBarStream, fileNames: string[]): ProgressSink {
    const rows: TerminalBarRow[] = fileNames.map((fileName) => ({ fileName, fraction: 0, countText: "" }));
    const drawRows = (): void => {
        for (const row of rows) {
            stream.write(`\x1b[2K${buildFileLine(row)}\n`);
        }
    };
    if (stream.isTTY === true) {
        drawRows();
    }
    return (event) => {
        if (stream.isTTY !== true) {
            if (event.current !== undefined) {
                stream.write(`${event.current}/${event.total}  ${event.label}\n`);
            }
            return;
        }
        const row = rows.find((candidateRow) => candidateRow.fileName === event.file)!;
        row.fraction = event.fileStepsDone! / event.fileStepsTotal!;
        row.countText = `${event.fileStepsDone}/${event.fileStepsTotal}`;
        if (event.current !== undefined) {
            row.countText = event.label.slice(row.fileName.length).trim();
        }
        // ponytail: redraws every row on each event and breaks when rows outnumber the terminal height; add a window of rows when that matters
        stream.write(`\x1b[${rows.length}A`);
        drawRows();
    };
}
