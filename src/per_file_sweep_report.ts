// The per-file sweep's pure half (task 186, spec S11): candidate selection out of git's
// name-status output, the per-candidate verdict, and the markdown results table that lands in
// plans/166-per-file-target.md. No I/O and no engine here — scripts/per_file_sweep.ts drives
// the reconstruction and calls these.

import { Path } from "./structures/domain.ts";
import { SweepVerdict } from "./structures/vocabulary.ts";

// One candidate's result. `revisions` is the recovered ladder length; `unrecoverable` counts the
// revisions the engine could not replay (FileRevision.unrecoverable) — the S11 "gaps itemized as
// findings, not omissions" signal.
export interface SweepRow {
    file: Path;
    revisions: number;
    baselineBlobMatched: boolean;
    diskMatched: boolean;
    unrecoverable: number;
    // Wall-clock seconds this candidate took, so a partial run's remaining cost is measurable
    // (the first candidate pays the shared script-run/lineage warm-up; later ones do not).
    seconds: number;
    note: string;
}

// The `git diff --name-status <commit>` line for one path: the status letter(s) first, the path
// LAST (a rename line is `R100\told\tnew`, whose candidate is the destination).
function parseNameStatusLine(line: string): { status: string; file: Path } | undefined {
    const fields = line.split("\t");
    if (fields.length < 2) {
        return undefined;
    }
    const status = fields[0]!.charAt(0);
    return { status, file: new Path(fields[fields.length - 1]!) };
}

// The candidates of one status letter (`M`, `A`, `D`) out of git's name-status output, in git's
// order.
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

// The row's verdict. Endpoint matches are necessary but NOT sufficient (spec S11's user
// correction): a ladder with unrecoverable revisions is `gaps`, never `ok`.
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
