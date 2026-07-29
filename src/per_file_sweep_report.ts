// Pure sweep logic: candidate selection, verdict, and markdown table (no I/O).

import { Path } from "./structures/domain.ts";
import { SweepVerdict } from "./structures/vocabulary.ts";

// `unrecoverable` counts revisions the engine could not replay (S11 gap signal).
export interface SweepRow {
    file: Path;
    revisions: number;
    baselineBlobMatched: boolean;
    diskMatched: boolean;
    unrecoverable: number;
    // Wall-clock seconds; first candidate includes shared warm-up cost.
    seconds: number;
    note: string;
}

// Parses one name-status line; for renames the candidate is the destination path.
function parseNameStatusLine(line: string): { status: string; file: Path } | undefined {
    const fields = line.split("\t");
    if (fields.length < 2) {
        return undefined;
    }
    const status = fields[0]!.charAt(0);
    return { status, file: new Path(fields[fields.length - 1]!) };
}

// The candidates of one status letter (`M`, `A`, `D`) out of git's name-status output, in git's order.
export function selectCandidatesByStatus(nameStatusText: string, status: string): Path[] {
    const candidates: Path[] = [];
    for (const line of nameStatusText.split("\n")) {
        const parsed = parseNameStatusLine(line.trim());
        if (parsed === undefined) {
            continue;
        }
        if (parsed.status !== status) {
            continue;
        }
        candidates.push(parsed.file);
    }
    return candidates;
}

// Endpoint matches alone are not sufficient; unrecoverable revisions yield `gaps`.
export function classifySweepRow(row: SweepRow): SweepVerdict {
    if (row.revisions === 0) {
        return SweepVerdict.none;
    }
    if (!row.baselineBlobMatched) {
        return SweepVerdict.endpointMiss;
    }
    if (!row.diskMatched) {
        return SweepVerdict.endpointMiss;
    }
    if (row.unrecoverable > 0) {
        return SweepVerdict.gaps;
    }
    return SweepVerdict.ok;
}

// A cell that can never break the table: any run of whitespace or pipes becomes one space.
function renderNoteCell(note: string): string {
    return note.replace(/[\s|]+/g, " ").trim();
}

function renderFlagCell(matched: boolean): string {
    return matched ? "yes" : "no";
}

function renderSweepRow(row: SweepRow): string {
    return [
        `\`${row.file.toString()}\``,
        String(row.revisions),
        renderFlagCell(row.baselineBlobMatched),
        renderFlagCell(row.diskMatched),
        String(row.unrecoverable),
        classifySweepRow(row),
        String(row.seconds),
        renderNoteCell(row.note),
    ].join(" | ");
}

// The results table for the S8 doc: one row per candidate, verdict included.
export function formatSweepTable(rows: SweepRow[]): string {
    const header = "| file | revisions | baseline blob | final = disk | unrecoverable | verdict | seconds | note |";
    const alignment = "| --- | --- | --- | --- | --- | --- | --- | --- |";
    const body = rows.map((row) => `| ${renderSweepRow(row)} |`);
    return [header, alignment, ...body].join("\n");
}

