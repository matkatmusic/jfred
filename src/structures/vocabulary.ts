// The s1 transcript's discriminant vocabulary — every string enum, in one canonical home, each
// paired with the runtime set of its wire strings (Object.values). Each member's value IS the wire
// string (enum-class style), so parsing is a validated cast, not a transform. Every structure file
// imports the discriminants it needs from here.

// The 10 record `type` values that occur in the s1-delete-file transcript
// (recon/06-s1-vocabulary.md). Later scenarios extend this: s4-overwrite-file adds queue-operation
// (a queued user prompt, modeled as discriminant only).
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
    // Session-meta records observed in real ~/.claude/projects transcripts (not the scenario
    // captures): a user-set conversation title and an agent name. Both discriminant-only, same
    // shape as ai-title (type + sessionId + one payload field).
    customTitle = "custom-title",
    agentName = "agent-name",
    // Observed opening real subagent transcripts (subagents/agent-*.jsonl line 1; 2026-07-05
    // corpus audit of ~/Programming/jot-recovery/claude-data/projects): names the forked agent
    // and its parent session. Carries agentId instead of sessionId, so META_KEYS doesn't apply.
    forkContextRef = "fork-context-ref",
    // Per-file backup pointer written by newer CC alongside file-history-snapshot
    // (s87 capture, 2026-07-17). Discriminant-only: sidecar backups on disk remain
    // the content source.
    fileHistoryDelta = "file-history-delta",
}

export const KNOWN_RECORD_TYPES: RecordType[] = Object.values(RecordType);

// The 4 `message.content` block types that occur in s1 (recon/07, recon/08),
// plus `image` (a pasted image in a real user turn).
export enum BlockType {
    text = "text",
    thinking = "thinking",
    tool_use = "tool_use",
    tool_result = "tool_result",
    image = "image",
}

export const KNOWN_CONTENT_BLOCK_TYPES: BlockType[] = Object.values(BlockType);

// Tool names observed across scenarios: Bash/Write in s1; Read/Edit added by s2-move-file (a move
// done as Read -> Edit -> Write -> Bash `mv`). The context-mode MCP execution tools (ctx_execute /
// ctx_execute_file / ctx_batch_execute) run a script in a sandbox — s37 applies a rename script
// through ctx_execute; each carries its source as `input.code`. Their values are the full
// `mcp__<server>__<tool>` wire strings.
export enum ToolName {
    Bash = "Bash",
    Write = "Write",
    Read = "Read",
    Edit = "Edit",
    CtxExecute = "mcp__plugin_context-mode_context-mode__ctx_execute",
    CtxExecuteFile = "mcp__plugin_context-mode_context-mode__ctx_execute_file",
    CtxBatchExecute = "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
}

// The tools that EXECUTE a script — and so can modify/create many tracked files with no per-file Write/Edit:
// the Bash shell and the context-mode MCP execution tools. A "run" is one such tool_use. Lives here (neutral)
// so both extraction (script-rename recovery) and the script-execution stage can share it without an import
// cycle between reconstruction_extract.ts and reconstruction_script_execution.ts.
export const EXECUTOR_TOOL_NAMES = new Set<string>([
    ToolName.Bash,
    ToolName.CtxExecute,
    ToolName.CtxExecuteFile,
    ToolName.CtxBatchExecute,
]);

// Attachment payload kinds observed across scenarios: 6 in s1; s2-move-file adds
// opened_file_in_ide, task_reminder, diagnostics; s15-user-edit-then-conv-rewind
// adds edited_text_file (a user's out-of-band disk edit, snippet = full post-edit
// content in `cat -n` form). The all-scenario re-run on a newer Claude Code adds
// command_permissions, hook_cancelled, selected_lines_in_ide (seen in s1/s2/s19),
// plus file and invoked_skills (seen in the compact-session scenarios, s63+).
// Modeled as discriminant only; per-kind payload fields are deferred
// (edited_text_file's filename/snippet are read via getAttachmentEntry).
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

// --- Field-key groups (top-level wire field names) ---------------------------
// The above enums are the discriminant *values*; these are top-level field *names* shared across
// records. TS types erase at runtime, so the parse gate (loadTranscript) and the hydrator
// (parseRecord) share these lists rather than each re-spelling the field names.

// The id-typed envelope fields, hydrated into Uuid by parseRecord.
export const ENVELOPE_ID_KEYS = ["uuid", "parentUuid", "sessionId"] as const;

// Every top-level key an EnvelopeBase carries (the runtime mirror of the EnvelopeBase type in
// envelope.ts) — the field set of every conversational record (user/assistant/system/attachment).
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

// --- Engine-side discriminants -----------------------------------------------
// Not a wire string: this names the reconstruction engine's own event kinds. It lives here so
// every enum has a single canonical home (coding-requirements §2).

// The evidence kinds the reconstruction engine replays. s1: write (create) and delete (Bash rm).
// s2-move-file adds edit (in-place splice) and rename (Bash mv). s3-copy-file adds copy (Bash cp).
// s4-overwrite-file adds overwrite (a second Write to a present file). s5-bash-redirect adds append
// (a >> redirect to a present file). s15-user-edit-then-conv-rewind adds user-edit (a user's
// out-of-band disk edit, captured as an edited_text_file attachment, replayed as a full-content
// revision like overwrite). s37-script-rename-driver-back-and-forth-mcp adds
// script-execution (the post-execution state of a recorded script run — Bash or MCP ctx_execute —
// replayed as a full-content revision and validated against the first confirmed post-execution
// beacon; distinct from `rename`, which is a path move). Later scenarios add read, etc.
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

// The classification Step 1 assigns to each raw JSONL line (s37 script-replay diagnostic). Anything
// not `ignore` lands in the kept partition; the member names the line-class richly enough that a later
// stage can do the full parse without re-classifying. Same string-enum style as EventKind.
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

// The from-scratch layered timeline's node classes (spec S1, from-scratch-reconstruction.hpp):
// beacon = verified full-content evidence (commit blob, snapshot, Write body, full Read echo);
// preAnchorStub = a byteless pre-anchor mention — position known, content unknown, display only;
// endState = the on-disk final node; presumedUserEdit = an unexplained adjacent-pair diff (the
// Q8 presumption — only evidence convicts); scriptRun = a recorded script execution.
export enum LayeredNodeKind {
    beacon = "beacon",
    preAnchorStub = "pre-anchor-stub",
    endState = "end-state",
    presumedUserEdit = "presumed-user-edit",
    scriptRun = "script-run",
}

export const KNOWN_LAYERED_NODE_KINDS: LayeredNodeKind[] = Object.values(LayeredNodeKind);

// The per-file sweep's verdict for one candidate file (spec S11, task 186). Endpoint matches
// (baseline blob present, final revision = current disk) are NECESSARY BUT NOT SUFFICIENT — a
// ladder holding unrecoverable revisions has gaps and must not read as a pass.
export enum SweepVerdict {
    ok = "ok",
    gaps = "gaps",
    endpointMiss = "endpoint-miss",
    none = "none",
}

// How a `--details` trace row is rendered: a short content preview, or the whole record
// pretty-printed. Enum so the renderer compares members, not bare strings (coding-req §4).
export enum TraceDetailMode {
    previewOnly = "preview-only",
    full = "full",
}

// The role a conversation branch plays in the two-DAG render (s12-write-conv-only-rewrite). The
// surviving branch holds the on-disk working tree; a rewound branch forked at a rewind point and was
// abandoned. Same string-enum style as EventKind so the renderer and the CLI speak one vocabulary.
export enum BranchRole {
    surviving = "surviving",
    rewound = "rewound",
}

// The viewer server's answer to "may I build this document?": build it, or first ask the user to
// consent to running the transcript's scripts (the /api/document 428 payload's discriminant).
export enum DocumentResponseKind {
    document = "document",
    consentRequired = "consent-required",
    // task 56: a configured base commit needs the user's pre-baseline answer first
    baselineQuestionRequired = "baseline-question",
    progress = "progress",
    error = "error",
}

// The git subcommand families the timeline annotates — the wire values of the document's
// gitOperations[].kind. Parsed from a command's first non-flag word after `git`; any subcommand
// outside the named set is `other`.
export enum GitOperationKind {
    init = "init",
    add = "add",
    commit = "commit",
    branch = "branch",
    checkout = "checkout",
    other = "other",
}

export const KNOWN_GIT_OPERATION_KINDS: GitOperationKind[] = Object.values(GitOperationKind);

// Where a partial-reconstruction failure was caught: one stage of one file's chain, a whole
// file's reconstruction, or one sub-phase of the document build.
export enum FailureScope {
    fileStage = "file-stage",
    file = "file",
    documentPhase = "document-phase",
}
