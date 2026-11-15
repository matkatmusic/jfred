import { readDrawnView } from "../bubbles/layer1-diff-wash.ts";
import type { TickBeaconFacts } from "../commits-column/layer1-cut-beacons.ts";
import { findCutRefusal } from "../commits-column/layer1-cut-rules.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";
import type { BarDotModel } from "./layer1-bars-model.ts";
import { findRealRulerTickRowIndex, findRulerRowIndexForInstant, listRealRulerRows } from "./layer1-bars-ruler.ts";
import { listChangedRowIndexesSinceTip, readTickIsChangedSinceTip } from "./layer1-bars-scissors.ts";
import { getBarsViewState } from "./layer1-bars-state.ts";
import { BAR_DOT_LABELS, BarDotKind, findGoneCommitIndex } from "./layer1-bars-wire.ts";

// TickBeaconFacts has no isChangedSinceTip yet (K2 adds it), so K1 names its own type.
export type BarsTickBeaconFacts = TickBeaconFacts & { isChangedSinceTip: boolean };

type BeaconRowFlags = { isBeacon: boolean; isCommit: boolean };

const BEACON_DOT_KINDS: ReadonlySet<BarDotKind> = new Set([BarDotKind.commit, BarDotKind.disk, BarDotKind.snapshot, BarDotKind.edit, BarDotKind.write]);

function readRowNewestMs(row: RulerRow): number {
    return Date.parse(row.instants[row.instants.length - 1]!);
}

// The kinds commit, disk, snapshot, edit and write count (P2 = A). Reads dot.kind only.
export function isBarsDotBeacon(dot: BarDotModel): boolean {
    return BEACON_DOT_KINDS.has(dot.kind);
}

// Per row index: whether a beacon dot and whether a commit dot lands on it. Rows come from the caller, never from state.rulerRows.
function collectBeaconRowFlags(rows: readonly RulerRow[]): Map<number, BeaconRowFlags> {
    const flagsByRowIndex = new Map<number, BeaconRowFlags>();
    for (const model of getBarsViewState().models) {
        for (const dot of model.dots) {
            if (isBarsDotBeacon(dot)) {
                const rowIndex = findRulerRowIndexForInstant(rows, dot.instant);
                let flags = flagsByRowIndex.get(rowIndex);
                if (flags === undefined) {
                    flags = { isBeacon: true, isCommit: false };
                    flagsByRowIndex.set(rowIndex, flags);
                }
                if (dot.kind === BarDotKind.commit) {
                    flags.isCommit = true;
                }
            }
        }
    }
    return flagsByRowIndex;
}

export function readBarsTickBeaconFacts(tick: HTMLElement): BarsTickBeaconFacts {
    const rows = listRealRulerRows();
    const rowIndex = findRealRulerTickRowIndex(tick);
    const flags = collectBeaconRowFlags(rows).get(rowIndex);
    const facts: BarsTickBeaconFacts = {
        isBeacon: false,
        isCommit: false,
        isChangedSinceTip: readTickIsChangedSinceTip(tick),
        instantMs: readRowNewestMs(rows[rowIndex]!),
    };
    if (flags !== undefined) {
        facts.isBeacon = flags.isBeacon;
        facts.isCommit = flags.isCommit;
    }
    return facts;
}

// tipMs undefined means the branch has no base.
export function listBarsMarkableRowIndexes(tipMs: number | undefined): number[] {
    const rows = listRealRulerRows();
    if (rows.length === 0) {
        return [];
    }
    const flagsByRowIndex = collectBeaconRowFlags(rows);
    let changedRowIndexes: number[] = [];
    if (tipMs !== undefined) {
        changedRowIndexes = listChangedRowIndexesSinceTip(rows, tipMs);
    }
    const markableRowIndexes: number[] = [];
    for (const [rowIndex, row] of rows.entries()) {
        const flags = flagsByRowIndex.get(rowIndex);
        const facts = {
            isBeacon: flags !== undefined,
            isCommit: flags?.isCommit === true,
            isChangedSinceTip: changedRowIndexes.includes(rowIndex),
            instantMs: readRowNewestMs(row),
            tipMs,
        };
        if (findCutRefusal(facts) === undefined) {
            markableRowIndexes.push(rowIndex);
        }
    }
    return markableRowIndexes;
}

// "<path>: <dot kind label> at <ISO time>" for the first beacon dot at or older than the mark row, per file. A file gone at the mark gets no line.
export function listBarsSnapLines(markMs: number): string[] {
    const rows = listRealRulerRows();
    const markRowIndex = findRulerRowIndexForInstant(rows, new Date(markMs).toISOString());
    const lines: string[] = [];
    for (const model of getBarsViewState().models) {
        const goneCommitIndex = findGoneCommitIndex(model.commits);
        let isGoneAtMark = false;
        if (goneCommitIndex !== undefined) {
            const goneRowIndex = findRulerRowIndexForInstant(rows, model.commits[goneCommitIndex]!.instant);
            isGoneAtMark = markRowIndex < goneRowIndex;
        }
        if (!isGoneAtMark) {
            const dot = model.dots.find((candidate) => {
                if (findRulerRowIndexForInstant(rows, candidate.instant) >= markRowIndex) {
                    return isBarsDotBeacon(candidate);
                }
                return false;
            });
            if (dot !== undefined) {
                let instantText = "now";
                if (dot.instant !== null) {
                    instantText = dot.instant;
                }
                lines.push(`${model.path}: ${BAR_DOT_LABELS[dot.kind]} at ${instantText}`);
            }
        }
    }
    return lines;
}

// The full hash of the project commit on the tick's row. Several on the row: the newest one.
export function readBarsBaseCommitHash(tick: HTMLElement): string {
    const drawnView = readDrawnView();
    if (drawnView === undefined) {
        throw new Error("no drawn view");
    }
    const rows = listRealRulerRows();
    const rowIndex = findRealRulerTickRowIndex(tick);
    let newestCommit: { instant: string; hash: string } | undefined;
    for (const pair of drawnView.pairs) {
        for (const commit of pair.commits) {
            if (findRulerRowIndexForInstant(rows, commit.instant) === rowIndex) {
                if (newestCommit === undefined) {
                    newestCommit = commit;
                } else if (Date.parse(commit.instant) > Date.parse(newestCommit.instant)) {
                    newestCommit = commit;
                }
            }
        }
    }
    if (newestCommit === undefined) {
        throw new Error("no project commit on the ruler row");
    }
    return newestCommit.hash;
}
