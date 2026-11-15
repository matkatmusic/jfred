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
    treeHash: string;
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
    if (line.file !== undefined) {
        if (line.current === undefined) {
            return InverseProgressLineKind.fileStep;
        }
        return InverseProgressLineKind.fileDone;
    }
    if (line.current === 0) {
        return InverseProgressLineKind.started;
    }
    return InverseProgressLineKind.other;
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

const EVENT_TYPE_DOT_KINDS: Record<string, BarDotKind> = {
    [InverseEventType.gitCommit]: BarDotKind.commit,
    [InverseEventType.backupSnapshot]: BarDotKind.snapshot,
    [InverseEventType.readWhole]: BarDotKind.read,
    [InverseEventType.writeRow]: BarDotKind.write,
    [InverseEventType.editRow]: BarDotKind.edit,
    [InverseEventType.readPartial]: BarDotKind.read,
    [InverseEventType.userEditNotice]: BarDotKind.edit,
    [InverseEventType.otherRow]: BarDotKind.edit,
    [InverseEventType.scriptReadOnly]: BarDotKind.script,
    [InverseEventType.scriptMayWrite]: BarDotKind.script,
};

const BAR_DOT_GROUPS: Record<BarDotKind, BarDotGroup> = {
    [BarDotKind.commit]: ShowRowKind.commit,
    [BarDotKind.snapshot]: ShowRowKind.snapshot,
    [BarDotKind.edit]: ShowRowKind.edit,
    [BarDotKind.write]: ShowRowKind.edit,
    [BarDotKind.read]: ShowRowKind.edit,
    [BarDotKind.script]: ShowRowKind.scriptRun,
    [BarDotKind.disk]: ShowRowKind.disk,
    [BarDotKind.created]: ShowRowKind.created,
    [BarDotKind.deleted]: ShowRowKind.created,
};

const CONFIDENCE_ALPHAS: Record<string, number> = {
    [InverseConfidence.proven]: 1,
    [InverseConfidence.confirmed]: 0.75,
    [InverseConfidence.derived]: 0.4,
};

export function readInverseEventType(eventType: string): InverseEventType {      // throws on an unknown string
    for (const knownEventType of Object.values(InverseEventType)) {
        if (knownEventType === eventType) {
            return knownEventType;
        }
    }
    throw new Error(`unknown inverse event type: ${eventType}`);
}
function getCommitAt(commits: readonly InverseCommitWire[], commitIndex: number): InverseCommitWire {
    const commit = commits[commitIndex];
    if (commit === undefined) {
        throw new Error(`no commit at index ${commitIndex}`);
    }
    return commit;
}
export function findGoneCommitIndex(commits: readonly InverseCommitWire[]): number | undefined {   // rule: "A file that is gone now" in section 2. commits is newest first.
    if (getCommitAt(commits, 0).isFileAbsent) {
        for (let commitIndex = 1; commitIndex < commits.length; commitIndex++) {
            const commit = getCommitAt(commits, commitIndex);
            if (!commit.isFileAbsent) {
                return undefined;
            }
            if (commit.isRemoved) {
                return commitIndex;
            }
            if (commit.movedAwayTo !== null) {
                return commitIndex;
            }
        }
    }
    return undefined;
}
export function getBarDotKind(commits: readonly InverseCommitWire[], commitIndex: number): BarDotKind {   // rules: "A file that is gone now", "Which commit is the creation" and "Event kind table" in section 2. commits is newest first.
    if (commitIndex === findGoneCommitIndex(commits)) {
        return BarDotKind.deleted;
    }
    const commit = getCommitAt(commits, commitIndex);
    const eventType = readInverseEventType(commit.eventType);
    if (eventType === InverseEventType.diskNow) {
        return BarDotKind.disk;
    }
    if (commitIndex === commits.length - 1) {
        if (commit.isFileAbsent) {
            if (!commit.isRemoved) {
                if (commit.movedAwayTo === null) {
                    if (commits.some((otherCommit) => !otherCommit.isFileAbsent)) {
                        return BarDotKind.created;
                    }
                }
            }
        }
    }
    const eventTypeDotKind = EVENT_TYPE_DOT_KINDS[eventType];
    if (eventTypeDotKind === undefined) {
        throw new Error(`an ${eventType} commit has no dot: an unknown state never becomes a commit`);
    }
    return eventTypeDotKind;
}
export function getBarDotGroup(kind: BarDotKind): BarDotGroup {
    return BAR_DOT_GROUPS[kind];
}
export function getConfidenceAlpha(confidence: string): number {                  // proven 1, confirmed 0.75, derived 0.4, anything else throws
    const alpha = CONFIDENCE_ALPHAS[confidence];
    if (alpha === undefined) {
        throw new Error(`no alpha for confidence: ${confidence}`);
    }
    return alpha;
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
const LAST_STAGE_DOT_KINDS: ReadonlySet<BarDotKind> = new Set([BarDotKind.disk, BarDotKind.created, BarDotKind.deleted]);
export function getBarsHistoryStageIndex(commits: readonly InverseCommitWire[], commitIndex: number): number {     // "Event kind table", last column. disk, created and deleted dots (by getBarDotKind) give BARS_LAST_STAGE_INDEX.
    const kind = getBarDotKind(commits, commitIndex);
    if (LAST_STAGE_DOT_KINDS.has(kind)) {
        return BARS_LAST_STAGE_INDEX;
    }
    const eventType = readInverseEventType(getCommitAt(commits, commitIndex).eventType);
    return BARS_HISTORY_STAGES.findIndex((stage) => stage.eventTypes.includes(eventType));
}
