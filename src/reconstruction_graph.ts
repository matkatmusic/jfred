// Two-DAG model + pure builders for the s12-write-conv-only-rewrite render. The conversationDAG forks
// at a rewind (one node per file-changing turn, plus a root); the fileDAG stays a per-file version
// list (true cross-branch disk lineage). Both share ONE letter per turn (assignTurnLetters), so a
// fileDAG `B` is the same turn as the conversationDAG `B`. Rendering lives in
// reconstruction_graph_render.ts. Design: plans/reconstruction-engine-design.md (spec 40).

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

// One file-changing turn as a graph node: its shared letter, what it did (kind/target), and the ids
// the renderer shortens. Topology only — file CONTENT stays in the content views.
export type GraphTurn = {
    letter: string;
    kind: EventKind;
    target: Path;
    changeId: Uuid;
    timestamp: Date;
};

// One branch of the conversationDAG: its role, its tip (identity), the rewind point it forked at
// (undefined for the surviving branch), and the turns it contributed after the fork.
export type ConvoBranch = {
    role: BranchRole;
    tip: Uuid;
    rewindPoint: Uuid | undefined;
    turns: GraphTurn[];
};

// The conversation graph: a root node (letter "A"), a linear trunk of turns when there is no fork, or
// a set of branch wrappers when a rewind changed files on more than one branch.
export type ConversationDag = {
    rootLetter: string;
    rootUuid: Uuid | undefined;
    trunk: GraphTurn[];
    branches: ConvoBranch[];
};

// One file's disk lineage: every version-ordered turn that touched it, across ALL branches.
export type FileDagEntry = { target: Path; turns: GraphTurn[] };

// The file graph: one entry per touched file, ordered by first touch.
export type FileDag = { files: FileDagEntry[] };

const ROOT_LETTER = "A";

// Bijective base-26 column label: 0 -> "A", 25 -> "Z", 26 -> "AA", 27 -> "AB" — so letters never run
// out past Z. Used with an offset of 1 so file turns start at "B" ("A" is the conversation root).
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

// The path a turn points at: a rename/copy is identified by its destination; everything else by its
// target. The one place the union's path field is resolved, so both builders agree.
function turnTarget(event: FileEvent): Path {
    if (event.kind === EventKind.rename || event.kind === EventKind.copy) {
        return event.to;
    }
    return event.target;
}

// Assign one letter per file-changing turn across ALL records, in timestamp order, starting at "B".
// The single source of letters for both graphs (decision 7), keyed by changeId string. `accepted`
// (when given) drops redundant disk-echo user edits so letters stay contiguous over real changes.
export function assignTurnLetters(records: TranscriptRecord[], accepted?: Set<string>): Map<string, string> {
    const letters = new Map<string, string>();
    extractRenderableEvents(records, accepted).forEach((event, index) => {
        letters.set(event.changeId.toString(), columnLabel(index + 1));
    });
    return letters;
}

// Turn a file event into a graph node, looking up its shared letter (a "?" placeholder should never
// appear — every extracted event was lettered by assignTurnLetters over the same records).
function toGraphTurn(event: FileEvent, letters: Map<string, string>): GraphTurn {
    return {
        letter: letters.get(event.changeId.toString()) ?? "?",
        kind: event.kind,
        target: turnTarget(event),
        changeId: event.changeId,
        timestamp: event.timestamp,
    };
}

// Group every file event by the file it touched, files ordered by first touch and turns by version
// (extractFileEvents is already timestamp-sorted). True cross-branch disk lineage (decision 9).
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

// One rewound branch's diverging file turns: the records on its tip's chain that are NOT on the
// surviving chain (exactly buildRewoundBranchHistory's diverging-records rule), turned into nodes.
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

// The surviving branch's diverging records: when there is a real fork, drop everything at or above the
// rewind point (the shared trunk) so only post-rewind turns remain; with no fork, keep them all so the
// whole surviving history renders as a linear trunk (decision 5).
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

// The surviving branch's turns: its post-fork file changes (all of them when there is no fork). Returns
// undefined when it changed no files (so the assembly drops it).
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
    // A file-less surviving branch is kept ONLY when a rewound branch exists, so the fork renders
    // honestly (two branches) instead of collapsing the abandoned branch into a misleading linear
    // trunk (S13). With no rewound branch (linear scenarios) it stays dropped, as before.
    if (rewound.length === 0) {
        return undefined;
    }
    const tip = survivingBranch?.tip ?? rootUuid;
    if (tip === undefined) {
        return undefined;
    }
    return { role: BranchRole.surviving, tip, rewindPoint: undefined, turns: [] };
}

// The conversation root: the first record with a uuid and no parent (the earliest such record in file
// order). undefined for an unrooted/meta-only record set.
function findRootUuid(records: TranscriptRecord[]): Uuid | undefined {
    for (const record of records) {
        const isRoot = record.parentUuid === null || record.parentUuid === undefined;
        if (record.uuid !== undefined && isRoot) {
            return record.uuid;
        }
    }
    return undefined;
}

// The earliest turn timestamp on a branch — branches render oldest-first. A file-less branch has no
// turn time, so it sorts LAST (a kept empty surviving branch renders below a rewound branch with turns).
function firstTurnTime(branch: ConvoBranch): number {
    if (branch.turns.length === 0) {
        return Number.POSITIVE_INFINITY;
    }
    return branch.turns[0]!.timestamp.getTime();
}

// Assemble the DAG: a single remaining branch becomes a linear trunk (no wrappers); two or more become
// branch wrappers ordered oldest-first.
function assembleDag(rootUuid: Uuid | undefined, kept: ConvoBranch[]): ConversationDag {
    if (kept.length <= 1) {
        return { rootLetter: ROOT_LETTER, rootUuid, trunk: kept[0]?.turns ?? [], branches: [] };
    }
    const ordered = [...kept].sort((a, b) => firstTurnTime(a) - firstTurnTime(b));
    return { rootLetter: ROOT_LETTER, rootUuid, trunk: [], branches: ordered };
}

// The conversationDAG's root node: the rewind/fork point when the conversation forked (the turns hang
// off where the branches diverge), else the conversation's parentUuid-null root for a linear history.
function resolveRootUuid(records: TranscriptRecord[], rewound: ConvoBranch[]): Uuid | undefined {
    return rewound[0]?.rewindPoint ?? findRootUuid(records);
}

// Build the conversationDAG: letter every turn, find the rewind branches, keep only those that changed
// files, and render a linear trunk when only one branch remains or forked wrappers when more do.
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

