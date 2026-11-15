import { readTipMs } from "../commits-column/layer1-jfred-state.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";
import { findRealRulerTickRowIndex, findRulerRowIndexForInstant, listRealRulerRows } from "./layer1-bars-ruler.ts";
import { getBarsViewState } from "./layer1-bars-state.ts";
import { InverseMoment, type InverseCommitWire } from "./layer1-bars-wire.ts";

// Page copy of the reader's selectInverseCommitAtInstant (engineV3/engineV3_inverse_repo_read.ts); it reads readerInstant. commits is newest first.
export function selectInverseCommitAtInstant(commits: readonly InverseCommitWire[], instantMs: number): InverseCommitWire | undefined {
    for (const [index, commit] of commits.entries()) {
        if (commit.readerInstant !== null) {
            if (Date.parse(commit.readerInstant) <= instantMs) {
                if (commit.moment === InverseMoment.atEvent) {
                    return commit;
                }
                const newerCommit = commits[index - 1];
                if (newerCommit !== undefined) {
                    if (newerCommit.moment === InverseMoment.beforeEvent) {
                        return newerCommit;
                    }
                }
                return undefined;
            }
        }
    }
    return undefined;
}

export function readTreeHashAtInstant(commits: readonly InverseCommitWire[], instantMs: number): string | undefined {
    return selectInverseCommitAtInstant(commits, instantMs)?.treeHash;
}

// Unknown on the row: no change. Unknown at the tip with a real state on the row: a change. Else compare the hashes.
export function isFileContentChanged(tipTreeHash: string | undefined, rowTreeHash: string | undefined): boolean {
    if (rowTreeHash === undefined) {
        return false;
    }
    if (tipTreeHash === undefined) {
        return true;
    }
    return tipTreeHash !== rowTreeHash;
}

// True when commits[commitIndex] differs from the next older commit that has an instant. No older commit, or an older commit with an unknown state after it, counts as a change. commits is newest first.
export function isCommitAChangeOfFile(commits: readonly InverseCommitWire[], commitIndex: number): boolean {
    const commit = commits[commitIndex]!;
    for (let olderIndex = commitIndex + 1; olderIndex < commits.length; olderIndex++) {
        const olderCommit = commits[olderIndex]!;
        if (olderCommit.readerInstant !== null) {
            if (olderCommit.moment !== InverseMoment.atEvent) {
                return true;
            }
            return commit.treeHash !== olderCommit.treeHash;
        }
    }
    return true;
}

function readRowNewestMs(row: RulerRow): number {
    return Date.parse(row.instants[row.instants.length - 1]!);
}

// ponytail: one pass over every commit of every model; a row not newer than the tip is never added.
function collectChangedRowIndexesSinceTip(rows: readonly RulerRow[], tipMs: number): Set<number> {
    const changedRowIndexes = new Set<number>();
    const rowNewestMsList = rows.map(readRowNewestMs);
    for (const model of getBarsViewState().models) {
        const tipTreeHash = readTreeHashAtInstant(model.commits, tipMs);
        for (const [commitIndex, commit] of model.commits.entries()) {
            const rowIndex = findRulerRowIndexForInstant(rows, commit.readerInstant);
            const rowNewestMs = rowNewestMsList[rowIndex]!;
            if (rowNewestMs > tipMs) {
                if (!changedRowIndexes.has(rowIndex)) {
                    if (isCommitAChangeOfFile(model.commits, commitIndex)) {
                        const rowTreeHash = readTreeHashAtInstant(model.commits, rowNewestMs);
                        if (isFileContentChanged(tipTreeHash, rowTreeHash)) {
                            changedRowIndexes.add(rowIndex);
                        }
                    }
                }
            }
        }
    }
    return changedRowIndexes;
}

// Row indexes (newest first) newer than the tip where a file has a change on the row and differs there from the tip.
export function listChangedRowIndexesSinceTip(rows: readonly RulerRow[], tipMs: number): number[] {
    return [...collectChangedRowIndexesSinceTip(rows, tipMs)].sort((first, second) => first - second);
}

// A row not newer than the tip gives false. A row index with no row throws.
export function isRowChangedSinceTip(rows: readonly RulerRow[], rowIndex: number, tipMs: number): boolean {
    if (rows[rowIndex] === undefined) {
        throw new Error("no ruler row at the index");
    }
    return collectChangedRowIndexesSinceTip(rows, tipMs).has(rowIndex);
}

// False when the branch has no tip. Works in both views: it reads the real ruler rows and the per-file commit lists only.
export function readTickIsChangedSinceTip(tick: HTMLElement): boolean {
    const tipMs = readTipMs();
    if (tipMs === undefined) {
        return false;
    }
    const rows = listRealRulerRows();
    return isRowChangedSinceTip(rows, findRealRulerTickRowIndex(tick), tipMs);
}
