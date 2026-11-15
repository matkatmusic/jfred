import { BarDotKind, findGoneCommitIndex, getBarDotGroup, getBarDotKind, getBarsHistoryStageIndex, getConfidenceAlpha, InverseEventType } from "./layer1-bars-wire.ts";
import type { BarDotGroup, InverseCommitWire, InverseRepoFileWire } from "./layer1-bars-wire.ts";
import { findRulerRowIndexForInstant } from "./layer1-bars-ruler.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";

export type BarDotModel = {
    commitIndex: number;      // index in BarFileModel.commits (newest first)
    commitHash: string;
    rowIndex: number;
    kind: BarDotKind;
    group: BarDotGroup;
    stageIndex: number;
    alpha: number;            // 1 for disk, created and deleted dots
    instant: string | null;
};
export const BarMarkKind = { removed: "removed", movedAway: "movedAway" } as const;
export type BarMarkKind = (typeof BarMarkKind)[keyof typeof BarMarkKind];
export type BarMarkModel = {
    kind: BarMarkKind;         // removed: draw "-". movedAway: draw "←".
    rowIndex: number;          // row of the commit that carries the flag
    movedAwayTo: string | null;   // the destination for movedAway, else null
};
export type BarFileModel = {
    path: string;
    startRowIndex: number;   // row of the gone commit, else 0 (section 2, "A file that is gone now")
    goneMarkKind: BarMarkKind | undefined;   // removed or movedAway from the gone commit, else undefined
    bornRowIndex: number;     // row of the created dot, else the last row
    isPlusShown: boolean;     // a created dot exists AND bornRowIndex < last row
    commits: InverseCommitWire[];
    dots: BarDotModel[];      // every commit except the DiskNow commit of a file with a gone commit, in commit order. Row indexes never decrease along the list.
    changes: BarDotModel[];   // dots whose kind is not disk, created or deleted
    marks: BarMarkModel[];    // one per commit with isRemoved or movedAwayTo, same order as commits
};

const FULL_ALPHA_DOT_KINDS: ReadonlySet<BarDotKind> = new Set([BarDotKind.disk, BarDotKind.created, BarDotKind.deleted]);

function buildCommitMark(commit: InverseCommitWire, rowIndex: number): BarMarkModel | undefined {
    if (commit.isRemoved) {
        if (commit.movedAwayTo !== null) {
            throw new Error(`commit ${commit.commitHash} is both removed and moved away`);
        }
        return { kind: BarMarkKind.removed, rowIndex, movedAwayTo: null };
    }
    if (commit.movedAwayTo !== null) {
        return { kind: BarMarkKind.movedAway, rowIndex, movedAwayTo: commit.movedAwayTo };
    }
    return undefined;
}

function buildBarFileModel(file: InverseRepoFileWire, rulerRows: readonly RulerRow[]): BarFileModel {
    const commits = file.commits;
    const goneCommitIndex = findGoneCommitIndex(commits);
    const dots: BarDotModel[] = [];
    const marks: BarMarkModel[] = [];
    let startRowIndex = 0;
    let goneMarkKind: BarMarkKind | undefined = undefined;
    let createdRowIndex: number | undefined = undefined;
    for (const [commitIndex, commit] of commits.entries()) {
        const rowIndex = findRulerRowIndexForInstant(rulerRows, commit.instant);
        const mark = buildCommitMark(commit, rowIndex);
        if (mark !== undefined) {
            marks.push(mark);
        }
        if (commitIndex === goneCommitIndex) {
            startRowIndex = rowIndex;
            goneMarkKind = commit.isRemoved ? BarMarkKind.removed : BarMarkKind.movedAway;
        }
        if (goneCommitIndex !== undefined) {
            if (commit.eventType === InverseEventType.diskNow) {
                continue;
            }
        }
        const kind = getBarDotKind(commits, commitIndex);
        if (kind === BarDotKind.created) {
            createdRowIndex = rowIndex;
        }
        let alpha = 1;
        if (!FULL_ALPHA_DOT_KINDS.has(kind)) {
            alpha = getConfidenceAlpha(commit.confidence);
        }
        dots.push({
            commitIndex,
            commitHash: commit.commitHash,
            rowIndex,
            kind,
            group: getBarDotGroup(kind),
            stageIndex: getBarsHistoryStageIndex(commits, commitIndex),
            alpha,
            instant: commit.instant,
        });
    }
    const lastRowIndex = rulerRows.length - 1;
    let bornRowIndex = lastRowIndex;
    let isPlusShown = false;
    if (createdRowIndex !== undefined) {
        bornRowIndex = createdRowIndex;
        isPlusShown = createdRowIndex < lastRowIndex;
    }
    const changes = dots.filter((dot) => !FULL_ALPHA_DOT_KINDS.has(dot.kind));
    return { path: file.file, startRowIndex, goneMarkKind, bornRowIndex, isPlusShown, commits, dots, changes, marks };
}

export function buildBarFileModels(files: InverseRepoFileWire[], rulerRows: readonly RulerRow[]): BarFileModel[] {
    return files.map((file) => buildBarFileModel(file, rulerRows));
}
export function isBarFileChangedSince(model: BarFileModel, selectedRowIndex: number): boolean {   // changes[0].rowIndex < selected, or bornRowIndex < selected; or the file has a gone commit and selected >= startRowIndex
    const newestChange = model.changes[0];
    if (newestChange !== undefined) {
        if (newestChange.rowIndex < selectedRowIndex) {
            return true;
        }
    }
    if (model.bornRowIndex < selectedRowIndex) {
        return true;
    }
    if (model.goneMarkKind !== undefined) {
        if (selectedRowIndex >= model.startRowIndex) {
            return true;
        }
    }
    return false;
}
export function countChangesNewerThanRow(model: BarFileModel, selectedRowIndex: number): number { // changes with rowIndex < selected
    return model.changes.filter((change) => change.rowIndex < selectedRowIndex).length;
}
export function computeFillPercent(model: BarFileModel, endRowIndex: number): number {             // 0 when endRowIndex <= startRowIndex, else (endRowIndex - startRowIndex) / max(bornRowIndex - startRowIndex, 1) * 100
    if (endRowIndex <= model.startRowIndex) {
        return 0;
    }
    const barSpanRows = Math.max(model.bornRowIndex - model.startRowIndex, 1);
    return (endRowIndex - model.startRowIndex) / barSpanRows * 100;
}
export function describeFinalState(model: BarFileModel, selectedRowIndex: number): string {       // "did not exist yet" when bornRowIndex < selected, else "Undid K of N changes"
    if (model.bornRowIndex < selectedRowIndex) {
        return "did not exist yet";
    }
    return `Undid ${countChangesNewerThanRow(model, selectedRowIndex)} of ${model.changes.length} changes`;
}
export function describeFoldedState(model: BarFileModel, selectedRowIndex: number): string {   // "same as now", "deleted, not restored yet" or "moved away, not restored yet" (section 2, "A file that is gone now")
    if (model.goneMarkKind !== undefined) {
        if (selectedRowIndex < model.startRowIndex) {
            if (model.goneMarkKind === BarMarkKind.removed) {
                return "deleted, not restored yet";
            }
            return "moved away, not restored yet";
        }
    }
    return "same as now";
}
export function describeStreamStep(fileStepsDone: number | undefined, fileStepsTotal: number | undefined): string { // "waiting" when either is undefined, else "step D of T"
    if (fileStepsDone === undefined) {
        return "waiting";
    }
    if (fileStepsTotal === undefined) {
        return "waiting";
    }
    return `step ${fileStepsDone} of ${fileStepsTotal}`;
}
