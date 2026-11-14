import type { BarDotGroup, BarDotKind, InverseCommitWire, InverseRepoFileWire } from "./layer1-bars-wire.ts";
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

export function buildBarFileModels(files: InverseRepoFileWire[], rulerRows: readonly RulerRow[]): BarFileModel[] {
    throw new Error("not built: buildBarFileModels");
}
export function isBarFileChangedSince(model: BarFileModel, selectedRowIndex: number): boolean {   // changes[0].rowIndex < selected, or bornRowIndex < selected; or the file has a gone commit and selected >= startRowIndex
    throw new Error("not built: isBarFileChangedSince");
}
export function countChangesNewerThanRow(model: BarFileModel, selectedRowIndex: number): number { // changes with rowIndex < selected
    throw new Error("not built: countChangesNewerThanRow");
}
export function computeFillPercent(model: BarFileModel, endRowIndex: number): number {             // 0 when endRowIndex <= startRowIndex, else (endRowIndex - startRowIndex) / max(bornRowIndex - startRowIndex, 1) * 100
    throw new Error("not built: computeFillPercent");
}
export function describeFinalState(model: BarFileModel, selectedRowIndex: number): string {       // "did not exist yet" when bornRowIndex < selected, else "Undid K of N changes"
    throw new Error("not built: describeFinalState");
}
export function describeFoldedState(model: BarFileModel, selectedRowIndex: number): string {   // "same as now", "deleted, not restored yet" or "moved away, not restored yet" (section 2, "A file that is gone now")
    throw new Error("not built: describeFoldedState");
}
export function describeStreamStep(fileStepsDone: number | undefined, fileStepsTotal: number | undefined): string { // "waiting" when either is undefined, else "step D of T"
    throw new Error("not built: describeStreamStep");
}
