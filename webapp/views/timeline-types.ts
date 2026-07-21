// Timeline view-model wire types + node types (split from timeline.ts, task 92).
// Wire-string discriminants mirror src/structures/vocabulary.ts — the webapp is a plain-JS
// browser runtime that cannot import the TS enums; the tests assert equivalence against the real
// enum members.

export const COMMIT_NODE_KIND = "commit";
export const USER_TURN_NODE_KIND = "user-turn";
export const AGENT_TURN_NODE_KIND = "agent-turn";
export const SESSION_END_NODE_KIND = "session-end";
export const TOOL_CALL_NODE_KIND = "tool-call";
export const USER_ROLE = "user";
export const EDIT_EVENT_KIND = "edit";
export const COMMIT_OPERATION_KIND = "commit";
// Item 77: the two EventKind wire strings the Files tree reads (a delete dims the row, a rename
// gives it its origin badge). Mirrored as consts like the kinds above — the webapp cannot import
// the TS enums; tests assert equivalence against the real vocabulary.ts members.
export const DELETE_EVENT_KIND = "delete";
export const RENAME_EVENT_KIND = "rename";

// ── local wire + view-model types ────────────────────────────────────────────────────────────────
// The document arrives via fetch + JSON.parse, so ids/paths/dates are plain strings on the wire;
// these declare only the fields this view reads.

export type WireRename = { from: string; to: string };
// A revision's per-line model (the engine's LineEntry); carried on the wire so the file-history view can
// render each revision's text from its own lines (no per-step file snapshot needed).
export type WireLineEntry = { values: { line: string }[] };
// unrecoverable (task 119): present when the engine could not replay this revision — its lines
// are the previous revision's carried forward, flagged with the failure reason.
export type WireRevision = { kind: string; changeId: string; timestamp: string; rename?: WireRename; lines?: WireLineEntry[]; unrecoverable?: { reason: string } };
export type WireFileHistory = { target: string; revisions: WireRevision[] };
// isOrphaned is the engine's per-record branch-membership stamp (true = rewound/abandoned
// branch); optional because an older cached document lacks the field (gitOperations convention).
export type WireMessage = { role: string; timestamp: string; sessionId?: string; uuid: string; text: string; isOrphaned?: boolean };
// A skeleton step snapshot: no `files` map (the >512 MB wire-size fix) — a step's file text is fetched
// on demand from /api/step-files when a chip is clicked.
export type WireStepSnapshot = {
    index: number;
    when: string;
    sessionId?: string;
    changeIds: string[];
    changedPaths: string[];
};
export type WireGitOperation = {
    kind: string;
    detail: string;
    command: string;
    timestamp: string;
    sessionId?: string;
    uuid?: string;
    // The commit's short hash from its tool_result text (item 66); absent on non-commit
    // operations, older cached documents, and commits whose result echoed no hash.
    resultHash?: string;
    // True when the command's own tool_result errored (task 103) — the timeline's red FAILED
    // badge; absent on success and on older cached documents.
    isError?: boolean;
};
export type WireCommitMarker = { timestamp: string; sessionId?: string };
// One non-file-edit tool call (item 55): summary is its one-line command/path/pattern; uuid is
// the record the row's line label and { } button resolve through; toolUseId joins the call to
// its hook attachments and tool_result lines.
export type WireToolCall = {
    toolName: string;
    summary: string;
    timestamp: string;
    sessionId?: string;
    uuid: string;
    toolUseId: string;
    // Engine-stamped branch membership (optional: older cached documents lack it).
    isOrphaned?: boolean;
};
// One script run and the files its consented sandbox execution changed (task 67); changedPaths
// is [] on a declined build. toolUseId joins the run to its Bash/MCP tool-call row.
export type WireScriptRun = {
    toolUseId?: string;
    timestamp: string;
    code: string;
    changedPaths: string[];
};
export type WireTimelineDocument = {
    filesTouched: WireFileHistory[];
    rewoundFilesTouched: WireFileHistory[];
    messages: WireMessage[];
    steps: WireStepSnapshot[];
    gitOperations?: WireGitOperation[];
    commitMarkers: WireCommitMarker[];
    // Optional: an older cached document lacks the field (same convention as gitOperations).
    toolCalls?: WireToolCall[];
    // Optional (same convention): the script runs and their sandbox-proven file changes.
    scriptRuns?: WireScriptRun[];
    // Optional (same convention): user-given session names from `custom-title` records.
    sessionTitles?: Record<string, string>;
    // Optional (same convention): lines the tolerant parse skipped (task 119) — the timeline's
    // dashed gap rows group them by contiguous run.
    skippedLines?: { filePath: string; lineNumber: number; timestamp?: string; reason: string }[];
    // Optional (same convention): every failure the engine survived (task 119) — the partial-
    // reconstruction banner's counts and tooltip reasons.
    failures?: { scope: string; stage: string; target?: string; reason: string }[];
    // Optional (same convention): the user declined pre-baseline reconstruction (task 56) —
    // the git-baseline node becomes the timeline's first shown step.
    preBaselineSkipped?: boolean;
};
export type WireJsonlFile = { fileName: string };
export type WireProjectListing = { name: string; jsonlFiles: WireJsonlFile[] };

// indexRevisionsByChangeId's entries: one changeId resolved to its displayable revision facts.
// displayPath is the name the file had AT that revision (task 127) — path stays the final
// target because every lookup/fetch keys on it.
export type RevisionIndexEntry = {
    path: string;
    displayPath: string;
    eventKind: string;
    renamedFrom: string | undefined;
    isFirstRevision: boolean;
    isRewound: boolean;
};
export type RevisionIndex = Map<string, RevisionIndexEntry>;

// deriveFileChanges' chips: one displayable file change per distinct path; `when` is the owning
// snapshot's instant (the chip row's timestamp, item 55).
// displayPath is the entry-time name for display only (task 127) — path stays the lookup and
// fetch key.
export type FileChange = {
    path: string;
    displayPath: string;
    eventKind: string;
    renamedFrom: string | undefined;
    isFirstRevision: boolean;
    changeId: string | undefined;
    when: string;
};

// The (sessionId, when) instant snapshot ownership is decided on (checkNodeCanOwnSnapshot).
export type SnapshotInstant = { sessionId?: string; when: string };

// A raw transcript position the inspector can open: (jsonl, its lines, 0-based line index).
export type TranscriptLocation = { jsonlName: string; rawLines: string[]; line: number };

// One conversation turn (user prompt or agent reply); synthetic trailing agent turns carry no uuid.
// stepNumber / fileChanges are stamped on after sorting (assignStepNumbers, deriveNodeFileChanges),
// hence optional. isOrphaned is copied from the engine's per-record wire stamp at node
// construction (message.isOrphaned); synthetic turns carry none.
export type TurnNode = {
    kind: typeof USER_TURN_NODE_KIND | typeof AGENT_TURN_NODE_KIND;
    when: string;
    sessionId: string | undefined;
    uuid?: string;
    text: string;
    isSystem?: boolean;
    snapshots: WireStepSnapshot[];
    gitOperations: WireGitOperation[];
    stepNumber?: number;
    fileChanges?: FileChange[];
    isOrphaned?: boolean;
    // True on the synthetic turn holding gitBase: baseline steps (task 86) — the row renders as
    // a regular message whose role pill reads "git-derived baseline".
    isGitBaseline?: boolean;
    detail?: undefined;
    resultHash?: undefined;
    isError?: undefined;
    summary?: undefined;
    toolName?: undefined;
    toolUseId?: undefined;
    scriptRun?: undefined;
};

// One session-end terminator per session (appendSessionEndNodes).
export type SessionEndNode = {
    kind: typeof SESSION_END_NODE_KIND;
    when: string;
    sessionId: string;
    snapshots: WireStepSnapshot[];
    stepNumber?: number;
    fileChanges?: FileChange[];
    isOrphaned?: boolean;
    isGitBaseline?: undefined;
    uuid?: undefined;
    text?: undefined;
    isSystem?: undefined;
    gitOperations?: undefined;
    detail?: undefined;
    resultHash?: undefined;
    isError?: undefined;
    summary?: undefined;
    toolName?: undefined;
    toolUseId?: undefined;
    scriptRun?: undefined;
};

// One git-commit hard stop (deriveCommitNodes); never numbered, never pickable.
export type CommitNode = {
    kind: typeof COMMIT_NODE_KIND;
    when: string;
    sessionId: string | undefined;
    detail?: string;
    // The commit's short hash (item 66) — the fork layout's `GIT COMMIT [hash]` pill.
    resultHash?: string;
    // True when the commit command's tool_result errored (task 103) — the row's FAILED badge.
    isError?: boolean;
    // task 121: the recorded base-commit row absorbs the git-derived baseline — it carries the
    // baseline flag, the baseline summary text, the absorbed beacon snapshots, and the seeded
    // file chips deriveNodeFileChanges stamps from them. All absent on plain commit rows.
    isGitBaseline?: boolean;
    text?: string;
    snapshots?: WireStepSnapshot[];
    fileChanges?: FileChange[];
    uuid?: undefined;
    isSystem?: undefined;
    gitOperations?: undefined;
    stepNumber?: undefined;
    isOrphaned?: undefined;
    summary?: undefined;
    toolName?: undefined;
    toolUseId?: undefined;
    scriptRun?: undefined;
};

// One un-bubbled tool-call row (item 55; deriveToolCallNodes): `* <summary> * [{ }] <TS> L:n`.
// Never numbered, never pickable; sorts chronologically among the turns it ran between.
export type ToolCallNode = {
    kind: typeof TOOL_CALL_NODE_KIND;
    when: string;
    sessionId: string | undefined;
    uuid: string;
    toolName: string;
    summary: string;
    toolUseId: string;
    // Copied from the engine's per-record wire stamp — a tool row on a rewound branch dims too.
    isOrphaned?: boolean;
    // True when this row is a FAILED git command's Bash call (task 103): stamped by joining the
    // node's record uuid to the document's errored gitOperations — the row's FAILED badge.
    isError?: boolean;
    // The script run this row executed, when its sandbox execution modified files (task 67):
    // joined by toolUseId in deriveToolCallNodes — drives the row badge and the Details pane's
    // script + before/after mode. Absent for read-only runs and non-script tool calls.
    scriptRun?: WireScriptRun;
    isGitBaseline?: undefined;
    text?: undefined;
    isSystem?: undefined;
    snapshots?: undefined;
    gitOperations?: undefined;
    stepNumber?: undefined;
    fileChanges?: undefined;
    detail?: undefined;
    resultHash?: undefined;
};

export type TimelineNode = TurnNode | SessionEndNode | CommitNode | ToolCallNode;
