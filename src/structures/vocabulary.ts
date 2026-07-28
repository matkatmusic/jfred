// The s1 transcript's discriminant vocabulary — every string enum, in one canonical home, each
// paired with the runtime set of its wire strings (Object.values). Each member's value IS the wire
// string (enum-class style), so parsing is a validated cast, not a transform. Every structure file
// imports the discriminants it needs from here.

// Record `type` values; later scenarios extend this set.
export enum RecordType {
    attachment = "attachment",
    assistant = "assistant",
    user = "user",
    system = "system",
    fileHistorySnapshot = "file-history-snapshot",
    lastPrompt = "last-prompt",
    mode = "mode",
    permissionMode = "permission-mode",
    bridgeSession = "bridge-session",
    aiTitle = "ai-title",
    queueOperation = "queue-operation",
    customTitle = "custom-title",
    agentName = "agent-name",
    // Opens subagent transcripts; carries agentId instead of sessionId, so META_KEYS does not apply.
    forkContextRef = "fork-context-ref",
    fileHistoryDelta = "file-history-delta",
}

export const KNOWN_RECORD_TYPES: RecordType[] = Object.values(RecordType);

export enum BlockType {
    text = "text",
    thinking = "thinking",
    tool_use = "tool_use",
    tool_result = "tool_result",
    image = "image",
}

export const KNOWN_CONTENT_BLOCK_TYPES: BlockType[] = Object.values(BlockType);

// The MCP members' values are the full `mcp__<server>__<tool>` wire strings; each carries its
// script source as `input.code`.
export enum ToolName {
    Bash = "Bash",
    Write = "Write",
    Read = "Read",
    Edit = "Edit",
    CtxExecute = "mcp__plugin_context-mode_context-mode__ctx_execute",
    CtxExecuteFile = "mcp__plugin_context-mode_context-mode__ctx_execute_file",
    CtxBatchExecute = "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
}

// Tools that execute a script, so they can change many tracked files with no per-file Write/Edit.
// Lives here so extraction and the script-execution stage share it without an import cycle.
export const EXECUTOR_TOOL_NAMES = new Set<string>([
    ToolName.Bash,
    ToolName.CtxExecute,
    ToolName.CtxExecuteFile,
    ToolName.CtxBatchExecute,
]);

// Discriminant only; per-kind payload fields are deferred (edited_text_file's filename/snippet
// are read via getAttachmentEntry).
export enum AttachmentPayloadType {
    hook_success = "hook_success",
    hook_system_message = "hook_system_message",
    hook_additional_context = "hook_additional_context",
    deferred_tools_delta = "deferred_tools_delta",
    agent_listing_delta = "agent_listing_delta",
    skill_listing = "skill_listing",
    opened_file_in_ide = "opened_file_in_ide",
    task_reminder = "task_reminder",
    diagnostics = "diagnostics",
    edited_text_file = "edited_text_file",
    command_permissions = "command_permissions",
    hook_cancelled = "hook_cancelled",
    selected_lines_in_ide = "selected_lines_in_ide",
    file = "file",
    invoked_skills = "invoked_skills",
}

export const ATTACHMENT_PAYLOAD_TYPES: AttachmentPayloadType[] = Object.values(AttachmentPayloadType);

// TS types erase at runtime, so the parse gate and the hydrator share these field-name lists
// instead of each re-spelling them.

// The id-typed envelope fields, hydrated into Uuid by parseRecord.
export const ENVELOPE_ID_KEYS = ["uuid", "parentUuid", "sessionId"] as const;

// Runtime mirror of the EnvelopeBase type in envelope.ts; keep the two in step.
export const ENVELOPE_KEYS = [
    "type",
    ...ENVELOPE_ID_KEYS,
    "isSidechain",
    "cwd",
    "gitBranch",
    "version",
    "timestamp",
    "userType",
    "entrypoint",
    "slug",
] as const;

// Not a wire string: this names the reconstruction engine's own event kinds. It lives here so
// every enum has a single canonical home (coding-requirements §2).

// The evidence kinds the reconstruction engine replays; scriptExecution is a full-content revision
// from a recorded run, distinct from `rename`'s path move.
export enum EventKind {
    write = "write",
    delete = "delete",
    edit = "edit",
    rename = "rename",
    copy = "copy",
    overwrite = "overwrite",
    append = "append",
    userEdit = "user-edit",
    scriptExecution = "script-execution",
}

// Step 1's per-line classification: anything not `ignore` is kept, named richly enough that a later
// stage parses without re-classifying.
export enum Verdict {
    write = "write",
    edit = "edit",
    bashFileOp = "bash-file-op",
    userEdit = "user-edit",
    editResult = "edit-result",
    readBeacon = "read-beacon",
    fileHistorySnapshot = "file-history-snapshot",
    scriptExecution = "script-execution",
    ignore = "ignore",
}

export const KNOWN_VERDICTS: Verdict[] = Object.values(Verdict);

// Layered-timeline node classes: beacon = verified full content; preAnchorStub = byteless, display
// only; presumedUserEdit = an unexplained adjacent-pair diff, since only evidence convicts.
export enum LayeredNodeKind {
    beacon = "beacon",
    preAnchorStub = "pre-anchor-stub",
    endState = "end-state",
    presumedUserEdit = "presumed-user-edit",
    scriptRun = "script-run",
}

export const KNOWN_LAYERED_NODE_KINDS: LayeredNodeKind[] = Object.values(LayeredNodeKind);

// Endpoint matches are necessary but NOT sufficient: a ladder holding unrecoverable revisions has
// gaps and must not read as a pass.
export enum SweepVerdict {
    ok = "ok",
    gaps = "gaps",
    endpointMiss = "endpoint-miss",
    none = "none",
}

// How a `--details` trace row is rendered: a short content preview, or the whole record.
export enum TraceDetailMode {
    previewOnly = "preview-only",
    full = "full",
}

// The surviving branch holds the on-disk working tree; a rewound branch forked at a rewind point
// and was abandoned.
export enum BranchRole {
    surviving = "surviving",
    rewound = "rewound",
}

// The /api/document payload's discriminant: build it, or first ask the user to consent to running
// the transcript's scripts.
export enum DocumentResponseKind {
    document = "document",
    consentRequired = "consent-required",
    baselineQuestionRequired = "baseline-question",
    progress = "progress",
    error = "error",
}

// Parsed from a command's first non-flag word after `git`; anything outside this set is `other`.
export enum GitOperationKind {
    init = "init",
    add = "add",
    commit = "commit",
    branch = "branch",
    checkout = "checkout",
    other = "other",
}

export const KNOWN_GIT_OPERATION_KINDS: GitOperationKind[] = Object.values(GitOperationKind);

// Where a partial-reconstruction failure was caught.
export enum FailureScope {
    fileStage = "file-stage",
    file = "file",
    documentPhase = "document-phase",
}
