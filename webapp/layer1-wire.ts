// Single source for Layer 1's wire vocabulary (task 331): generic shapes per instant/path/id, const objects not `enum`.

export interface WireInstantOf<I> {
    instant: I;
    axisPx: number;
}

export interface WireCommitOf<I> extends WireInstantOf<I> {
    hash: string;
}

// One RULER entry: a widened instant, plus the node count (task 275).
export interface WireRulerTickOf<I> extends WireInstantOf<I> {
    // How many nodes the view draws at this instant, across every bubble.
    eventCount: number;
}

// Task 312: a snapshot node; @vN is per session, so sessionId identifies it.
export interface WireSnapshotOf<I, P, U> extends WireInstantOf<I> {
    version: number;
    sessionId: U;
    sessionFile: P;
    line?: number;
}

// Wire spelling of ScriptExecutorKind (src/reconstruction_script_execution.ts) — drives the never-provable idiom.
export const WireScriptExecutorKind = {
    python: "python",
    bash: "bash",
} as const;
export type WireScriptExecutorKind = (typeof WireScriptExecutorKind)[keyof typeof WireScriptExecutorKind];

// Task 356: a script-run node; identity is scriptRun:<toolUseId> — one shared drawer across every bubble it touches.
export interface WireScriptRunOf<I, P, U> extends WireInstantOf<I> {
    toolUseId: U;
    executorKind: WireScriptExecutorKind;
    // The resolved body (resolveScriptIndirection already ran engine-side) — the client never re-resolves it.
    code: string;
    // Absent when the engine's static scan named no file for this pair; the node still renders, unlabeled.
    label?: string;
}

export interface WirePairOf<I, P, U> {
    path: P;
    // Oldest first, as the endpoint emits them.
    commits: WireCommitOf<I>[];
    onDisk: WireInstantOf<I>;
    // Task 298: absent unless the file's birth is trustworthy AND earlier than its mtime.
    created?: WireInstantOf<I>;
    // Task 312: absent when the file has none, so a snapshot-free pair's shape is unchanged.
    snapshots?: WireSnapshotOf<I, P, U>[];
    // Task 356: absent unless this pair's path is one the engine's static scan named for some script run.
    scriptRuns?: WireScriptRunOf<I, P, U>[];
}

export interface WireOrphanOf<I, P, U> extends WireInstantOf<I> {
    path: P;
    snapshots?: WireSnapshotOf<I, P, U>[];
}

export interface WireLayer1ViewOf<I, P, U> {
    pairs: WirePairOf<I, P, U>[];
    gitOrphans: WireOrphanOf<I, P, U>[];
    diskOrphans: WireOrphanOf<I, P, U>[];
    // Every distinct instant the view draws, ascending.
    ruler: WireRulerTickOf<I>[];
}

// The client instantiation: what JSON.parse yields from /api/layer1-view — `Path`/`Uuid` are plain strings and `Instant` is ISO text.
export type WireInstant = WireInstantOf<string>;
export type WireCommit = WireCommitOf<string>;
export type WireRulerTick = WireRulerTickOf<string>;
export type WireSnapshot = WireSnapshotOf<string, string, string>;
export type WireScriptRun = WireScriptRunOf<string, string, string>;
export type WirePair = WirePairOf<string, string, string>;
export type WireOrphan = WireOrphanOf<string, string, string>;
export type WireLayer1View = WireLayer1ViewOf<string, string, string>;

// One session transcript from /api/layer1-sessions (task 292); all-strings on both sides, so no generic.
export interface WireSession {
    file: string;
    // Absolute path: the wire identity, because two source folders can hold the same basename.
    fullPath: string;
    title: string;
    started: string;
    ended: string;
    // Every file the session touched, which is all the filter needs.
    paths: string[];
}

// One commit row on the wire, as /api/repo-commits and /api/layer1-refs render it. All-strings on both sides.
export type RepoCommitRow = { hash: string; date: string; subject: string };

// The /api/layer1-refs shape filling Layer 1's two header dropdowns (task 286).
export interface Layer1RefsView {
    branches: string[];        // local branch names, the checked-out one first
    head: string;              // the branch name the repo is currently on
    commits: RepoCommitRow[];  // newest first, capped at LAYER1_REF_COMMIT_LIMIT
}

// Which git stamp places a commit (task 282); committer FIRST — the default `Object.values` order feeds the toggle.
export const CommitTimeSource = {
    committer: "committer",
    author: "author",
} as const;
export type CommitTimeSource = (typeof CommitTimeSource)[keyof typeof CommitTimeSource];

// Which source folder Layer 1's picker scans (task 296): transcripts or a snapshot store. Values ARE the `kind=` spelling.
export const SourceKind = {
    jsonl: "jsonl",
    fileHistory: "filehistory",
} as const;
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

// Pair ladder ORDER (task 331): created, commits, on-disk, snapshots, script runs; raw `I`.
export function listPairLadderInstants<I, P, U>(pair: WirePairOf<I, P, U>): I[] {
    const created = pair.created === undefined ? [] : [pair.created.instant];
    return [
        ...created,
        ...pair.commits.map((commit) => commit.instant),
        pair.onDisk.instant,
        ...(pair.snapshots ?? []).map((snapshot) => snapshot.instant),
        ...(pair.scriptRuns ?? []).map((run) => run.instant),
    ];
}

// A disk orphan's own node leads, its snapshots follow — the server's third ladder group exactly.
export function listOrphanLadderInstants<I, P, U>(orphan: WireOrphanOf<I, P, U>): I[] {
    return [orphan.instant, ...(orphan.snapshots ?? []).map((snapshot) => snapshot.instant)];
}
