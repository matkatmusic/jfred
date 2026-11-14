import { ShowRowKind } from "../show-row/layer1-show-row.ts";

export const InverseEventType = {
    diskNow: "DiskNow",
    gitCommit: "GitCommit",
    backupSnapshot: "BackupSnapshot",
    writeRow: "WriteRow",
    editRow: "EditRow",
    readWhole: "ReadWhole",
    readPartial: "ReadPartial",
    scriptReadOnly: "ScriptReadOnly",
    scriptMayWrite: "ScriptMayWrite",
    otherRow: "OtherRow",
    userEditNotice: "UserEditNotice",
    rowBytesUnknown: "RowBytesUnknown",
} as const;
export type InverseEventType = (typeof InverseEventType)[keyof typeof InverseEventType];

export const InverseConfidence = { proven: "proven", confirmed: "confirmed", derived: "derived", unknown: "unknown" } as const;
export type InverseConfidence = (typeof InverseConfidence)[keyof typeof InverseConfidence];

export type InverseCommitWire = {
    commitHash: string;
    eventType: string;
    moment: string;
    confidence: string;
    position: number;
    instant: string | null;
    isFileAbsent: boolean;
    isRemoved: boolean;               // a Bash rm of this file: the page draws "-"
    movedAwayTo: string | null;       // a Bash mv of this file to this path (absolute): the page draws "←"
};
export type InverseRepoFileWire = { file: string; commits: InverseCommitWire[] };
export type InverseReposWire = { files: InverseRepoFileWire[] };
export type InverseStateWire = { file: string; commit: InverseCommitWire | null; text: string | null };

export type InverseProgressLine = {
    kind: "progress";
    label: string;
    current?: number;
    total?: number;
    steps?: string[];
    file?: string;
    fileStepsDone?: number;
    fileStepsTotal?: number;
};
export const InverseProgressLineKind = { started: "started", fileStep: "fileStep", fileDone: "fileDone", other: "other" } as const;
export type InverseProgressLineKind = (typeof InverseProgressLineKind)[keyof typeof InverseProgressLineKind];
// file set and current missing: fileStep. file set and current set: fileDone. file missing and current === 0: started. Anything else: other.
export function classifyInverseProgressLine(line: InverseProgressLine): InverseProgressLineKind {
    throw new Error("not built: classifyInverseProgressLine");
}

export const BarDotKind = {
    commit: "commit", snapshot: "snapshot", edit: "edit", write: "write", read: "read", script: "script", disk: "disk", created: "created", deleted: "deleted",
} as const;
export type BarDotKind = (typeof BarDotKind)[keyof typeof BarDotKind];
export type BarDotGroup = typeof ShowRowKind.created | typeof ShowRowKind.commit | typeof ShowRowKind.disk | typeof ShowRowKind.snapshot | typeof ShowRowKind.edit | typeof ShowRowKind.scriptRun;
export const BAR_DOT_LABELS: Record<BarDotKind, string> = {
    [BarDotKind.commit]: "commit",
    [BarDotKind.snapshot]: "snapshot",
    [BarDotKind.edit]: "edit",
    [BarDotKind.write]: "write",
    [BarDotKind.read]: "read",
    [BarDotKind.script]: "script run",
    [BarDotKind.disk]: "disk now",
    [BarDotKind.created]: "created",
    [BarDotKind.deleted]: "deleted",
};

export function readInverseEventType(eventType: string): InverseEventType {      // throws on an unknown string
    throw new Error("not built: readInverseEventType");
}
export function findGoneCommitIndex(commits: readonly InverseCommitWire[]): number | undefined {   // rule: "A file that is gone now" in section 2. commits is newest first.
    throw new Error("not built: findGoneCommitIndex");
}
export function getBarDotKind(commits: readonly InverseCommitWire[], commitIndex: number): BarDotKind {   // rules: "A file that is gone now", "Which commit is the creation" and "Event kind table" in section 2. commits is newest first.
    throw new Error("not built: getBarDotKind");
}
export function getBarDotGroup(kind: BarDotKind): BarDotGroup {
    throw new Error("not built: getBarDotGroup");
}
export function getConfidenceAlpha(confidence: string): number {                  // proven 1, confirmed 0.75, derived 0.4, anything else throws
    throw new Error("not built: getConfidenceAlpha");
}

export type BarsHistoryStage = { text: string; eventTypes: InverseEventType[] };
export const BARS_HISTORY_STAGES: BarsHistoryStage[] = [
    { text: "No reconstruction history yet", eventTypes: [] },
    { text: "Loading commits", eventTypes: [InverseEventType.gitCommit] },
    { text: "Loading snapshots", eventTypes: [InverseEventType.backupSnapshot] },
    { text: "Loading full reads", eventTypes: [InverseEventType.readWhole] },
    { text: "Loading edits", eventTypes: [InverseEventType.writeRow, InverseEventType.editRow, InverseEventType.readPartial, InverseEventType.userEditNotice, InverseEventType.otherRow] },
    { text: "Loading script replays", eventTypes: [InverseEventType.scriptReadOnly, InverseEventType.scriptMayWrite] },
    { text: "Change history is complete", eventTypes: [] },
];
export const BARS_LAST_STAGE_INDEX: number = BARS_HISTORY_STAGES.length - 1;
export function getBarsHistoryStageIndex(commits: readonly InverseCommitWire[], commitIndex: number): number {     // "Event kind table", last column. disk, created and deleted dots (by getBarDotKind) give BARS_LAST_STAGE_INDEX.
    throw new Error("not built: getBarsHistoryStageIndex");
}
