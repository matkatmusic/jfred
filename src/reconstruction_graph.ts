// Two-DAG model: conversationDAG forks at rewinds, fileDAG is per-file cross-branch lineage sharing one letter per turn (spec 40).

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { BranchRole, EventKind } from "./structures/vocabulary.ts";
import {
    collectAcceptedUserEditIds,
    extractRenderableEvents,
} from "./reconstruction_renderable.ts";
import {
    collectSurvivingUuids,
    findConversationBranches,
    selectBranchRecords,
    selectLiveBranch,
    type ConversationBranch,
} from "./reconstruction_branch.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { FileEvent } from "./reconstruction_engine.ts";

// Topology only — file CONTENT stays in the content views.
export type GraphTurn = {
    letter: string;
    kind: EventKind;
    target: Path;
    changeId: Uuid;
    timestamp: Date;
};

// `rewindPoint` is undefined for the surviving branch; `turns` are those contributed after the fork.
export type ConvoBranch = {
    role: BranchRole;
    tip: Uuid;
    rewindPoint: Uuid | undefined;
    turns: GraphTurn[];
};

// A linear trunk when there is no fork; branch wrappers when a rewind changed files on more branches.
export type ConversationDag = {
    rootLetter: string;
    rootUuid: Uuid | undefined;
    trunk: GraphTurn[];
    branches: ConvoBranch[];
};

// One file's disk lineage: every version-ordered turn that touched it, across ALL branches.
export type FileDagEntry = { target: Path; turns: GraphTurn[] };

export type FileDag = { files: FileDagEntry[] };

const ROOT_LETTER = "A";

// Bijective base-26 so letters never run out past Z; callers offset by 1 since "A" is the root.
function columnLabel(index: number): string {
    let label = "";
    let n = index + 1;
    while (n > 0) {
        const remainder = (n - 1) % 26;
        label = String.fromCharCode(65 + remainder) + label;
        n = Math.floor((n - 1) / 26);
    }
    return label;
}

// The one place the union's path field is resolved, so both builders agree.
function turnTarget(event: FileEvent): Path {
    if (event.kind === EventKind.rename || event.kind === EventKind.copy) {
        return event.to;
    }
    return event.target;
}

// The single source of letters for both graphs (decision 7); `accepted` drops disk-echo edits so letters stay contiguous.
export function assignTurnLetters(records: TranscriptRecord[], accepted?: Set<string>): Map<string, string> {
    const letters = new Map<string, string>();
    extractRenderableEvents(records, accepted).forEach((event, index) => {
        letters.set(event.changeId.toString(), columnLabel(index + 1));
    });
    return letters;
}

// The "?" placeholder should never appear: assignTurnLetters lettered every event over these records.
function toGraphTurn(event: FileEvent, letters: Map<string, string>): GraphTurn {
    return {
        letter: letters.get(event.changeId.toString()) ?? "?",
        kind: event.kind,
        target: turnTarget(event),
        changeId: event.changeId,
        timestamp: event.timestamp,
    };
}

// True cross-branch disk lineage (decision 9); extractFileEvents is already timestamp-sorted.
export function buildFileDag(records: TranscriptRecord[], reader?: BackupReader): FileDag {
    const accepted = collectAcceptedUserEditIds(records, reader);
    const letters = assignTurnLetters(records, accepted);
    const groups = new Map<string, GraphTurn[]>();
    const order: string[] = [];
    for (const event of extractRenderableEvents(records, accepted)) {
        const turn = toGraphTurn(event, letters);
        const key = turn.target.toString();
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key)!.push(turn);
    }
    return { files: order.map((key) => ({ target: new Path(key), turns: groups.get(key)! })) };
}

// Diverging records = on the tip's chain but NOT the surviving chain, matching buildRewoundBranchHistory's rule.
function buildRewoundConvoBranch(
    records: TranscriptRecord[],
    branch: ConversationBranch,
    survivingUuids: Set<string>,
    letters: Map<string, string>,
    accepted: Set<string>,
): ConvoBranch {
    const branchRecords = selectBranchRecords(records, branch.tip);
    const diverging = branchRecords.filter(
        (record) => record.uuid !== undefined && !survivingUuids.has(record.uuid.toString()),
    );
    const turns = extractRenderableEvents(diverging, accepted).map((event) =>
        toGraphTurn(event, letters),
    );
    return { role: BranchRole.rewound, tip: branch.tip, rewindPoint: branch.rewindPoint, turns };
}

// With a fork, drop shared trunk so only post-rewind turns remain; with no fork keep them all (decision 5).
function selectPostForkRecords(
    records: TranscriptRecord[],
    branchRecords: TranscriptRecord[],
    rewound: ConvoBranch[],
): TranscriptRecord[] {
    const forkPoint = rewound[0]?.rewindPoint;
    if (forkPoint === undefined) {
        return branchRecords;
    }
    const forkUuids = collectAncestorUuids(records, forkPoint);
    return branchRecords.filter(
        (record) => record.uuid !== undefined && !forkUuids.has(record.uuid.toString()),
    );
}

// Returns undefined when the branch changed no files, so the assembly drops it.
function buildSurvivingConvoBranch(
    records: TranscriptRecord[],
    survivingBranch: ConversationBranch | undefined,
    rewound: ConvoBranch[],
    rootUuid: Uuid | undefined,
    letters: Map<string, string>,
    accepted: Set<string>,
): ConvoBranch | undefined {
    const branchRecords = survivingBranch
        ? selectBranchRecords(records, survivingBranch.tip)
        : selectLiveBranch(records);
    const postFork = selectPostForkRecords(records, branchRecords, rewound);
    const turns = extractRenderableEvents(postFork, accepted).map(
        (event) => toGraphTurn(event, letters),
    );
    if (turns.length > 0) {
        const tip = survivingBranch?.tip ?? rootUuid ?? turns[turns.length - 1]!.changeId;
        return { role: BranchRole.surviving, tip, rewindPoint: undefined, turns };
    }
    // A file-less surviving branch is kept ONLY when a rewound branch exists (S13).
    if (rewound.length === 0) {
        return undefined;
    }
    const tip = survivingBranch?.tip ?? rootUuid;
    if (tip === undefined) {
        return undefined;
    }
    return { role: BranchRole.surviving, tip, rewindPoint: undefined, turns: [] };
}

// Undefined for an unrooted/meta-only record set.
function findRootUuid(records: TranscriptRecord[]): Uuid | undefined {
    for (const record of records) {
        const isRoot = record.parentUuid === null || record.parentUuid === undefined;
        if (record.uuid !== undefined && isRoot) {
            return record.uuid;
        }
    }
    return undefined;
}

// Branches render oldest-first; a file-less branch has no turn time, so it sorts LAST.
function firstTurnTime(branch: ConvoBranch): number {
    if (branch.turns.length === 0) {
        return Number.POSITIVE_INFINITY;
    }
    return branch.turns[0]!.timestamp.getTime();
}

// A single remaining branch becomes a linear trunk; two or more become wrappers, oldest-first.
function assembleDag(rootUuid: Uuid | undefined, kept: ConvoBranch[]): ConversationDag {
    if (kept.length <= 1) {
        return { rootLetter: ROOT_LETTER, rootUuid, trunk: kept[0]?.turns ?? [], branches: [] };
    }
    const ordered = [...kept].sort((a, b) => firstTurnTime(a) - firstTurnTime(b));
    return { rootLetter: ROOT_LETTER, rootUuid, trunk: [], branches: ordered };
}

// Turns hang off where the branches diverge, so a forked history roots at the rewind point.
function resolveRootUuid(records: TranscriptRecord[], rewound: ConvoBranch[]): Uuid | undefined {
    return rewound[0]?.rewindPoint ?? findRootUuid(records);
}

// Only branches that changed files are kept.
export function buildConversationDag(records: TranscriptRecord[], reader?: BackupReader): ConversationDag {
    const accepted = collectAcceptedUserEditIds(records, reader);
    const letters = assignTurnLetters(records, accepted);
    const branches = findConversationBranches(records);
    const survivingBranch = branches.find((branch) => branch.isSurviving);
    const survivingUuids = collectSurvivingUuids(records);
    const rewoundBranches = branches.filter((branch) => !branch.isSurviving);
    const rewoundConvoBranches = rewoundBranches.map((branch) => buildRewoundConvoBranch(records, branch, survivingUuids, letters, accepted));
    const rewound = rewoundConvoBranches.filter((branch) => branch.turns.length > 0);
    const rootUuid = resolveRootUuid(records, rewound);
    const surviving = buildSurvivingConvoBranch(records, survivingBranch, rewound, rootUuid, letters, accepted);
    const kept = surviving === undefined ? rewound : [surviving, ...rewound];
    return assembleDag(rootUuid, kept);
}

