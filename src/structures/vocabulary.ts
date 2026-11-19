// Every string enum in one home; a member's value IS the wire string, so parsing is a validated cast.

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
  server_tool_use = "server_tool_use",
  advisor_tool_result = "advisor_tool_result",
}

export const KNOWN_CONTENT_BLOCK_TYPES: BlockType[] = Object.values(BlockType);

// The MCP members' values are the full `mcp__<server>__<tool>` wire strings; each carries its script source as `input.code`.
export enum ToolName {
  Bash = "Bash",
  Write = "Write",
  Read = "Read",
  Edit = "Edit",
  Grep = "Grep",
  CtxExecute = "mcp__plugin_context-mode_context-mode__ctx_execute",
  CtxExecuteFile = "mcp__plugin_context-mode_context-mode__ctx_execute_file",
  CtxBatchExecute = "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
}

// Tools that execute a script, so they change many tracked files with no per-file Write/Edit.
export const EXECUTOR_TOOL_NAMES = new Set<string>([
  ToolName.Bash,
  ToolName.CtxExecute,
  ToolName.CtxExecuteFile,
  ToolName.CtxBatchExecute,
]);

// Discriminant only; per-kind payload fields are deferred (edited_text_file's filename/snippet are read via getAttachmentEntry).
export enum AttachmentPayloadType {
  hook_success = "hook_success",
  hook_blocking_error = "hook_blocking_error",
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

// TS types erase at runtime, so the parse gate and hydrator share these field-name lists.

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

// Not a wire string: the engine's own event kinds, kept here so every enum has one home.

// Evidence kinds the engine replays; scriptExecution is full content, distinct from `rename`'s path move.
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

// Step 1's per-line classification: anything not `ignore` is kept, named richly enough that a later stage parses without re-classifying.
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

export enum InverseStepEngine {
    Backward = "backward",
    Forward = "forward",
    BothFailed = "both-failed",
    Replay = "replay",
}

export enum InverseStepOutcome {
    NewText = "new-text",
    FileAbsent = "file-absent",
    UnknownOrRoadblock = "unknown-or-roadblock",
    NoOlderChange = "no-older-change",
    MovedBack = "moved-back",
    NoNewerChange = "no-newer-change",
    Paused = "paused",
    Replayed = "replayed",
    ReplayRefused = "replay-refused",
    AlreadyStored = "already-stored",
    StartAtReached = "start-at-reached",
}

export enum InverseRepoMode {
    OnDemand = "on-demand",
}

export enum OtherFilesPolicy {
    WalkThem = "walk-them",
    RefuseIfUnfinished = "refuse-if-unfinished",
}

export enum StepCommand {
    Forward = "forward",
    Backward = "backward",
    Quit = "quit",
    Replay = "replay",
}

export enum StopGapKind {
    Found = "found",
    Refused = "refused",
}

export enum StepAllVerdict {
    End = "end",
    Crash = "crash",
    BackwardFailure = "b-failure",
}

export enum StepAllReplayKind {
    Proven = "proven",
    Derived = "derived",
    Refused = "refused",
    Failed = "failed",
}

export enum TuiCommand {
    MoveSelectionUp = "moveSelectionUp",
    MoveSelectionDown = "moveSelectionDown",
    ToggleSelection = "toggleSelection",
    ExtendSelection = "extendSelection",
    ResetSelectedStores = "resetSelectedStores",
    ResetAllStores = "resetAllStores",
    StepSelectionTowardsNow = "stepSelectionTowardsNow",
    StepSelectionTowardsEarliest = "stepSelectionTowardsEarliest",
    StepAllTowardsNow = "stepAllTowardsNow",
    StepAllTowardsEarliest = "stepAllTowardsEarliest",
    ToggleDaySpeed = "toggleDaySpeed",
    ToggleWeekSpeed = "toggleWeekSpeed",
    PlayScript = "playScript",
    SetEventSpeed = "setEventSpeed",
    ViewFile = "viewFile",
    OpenConsole = "openConsole",
    ReconstructUntilEarliest = "reconstructUntilEarliest",
    CloseBox = "closeBox",
    ScrollUp = "scrollUp",
    ScrollDown = "scrollDown",
    OpenLogFolder = "openLogFolder",
    ViewFileStepTowardsNow = "viewFileStepTowardsNow",
    ViewFileStepTowardsEarliest = "viewFileStepTowardsEarliest",
    ToggleDiffView = "toggleDiffView",
}

// How one row of the side-by-side diff in the View File box compares its two sides.
export enum DiffRowKind {
    Same = "same",
    Changed = "changed",
    OnlyNewer = "onlyNewer",
    OnlyMarker = "onlyMarker",
}

// The two sides of the side-by-side diff in the View File box.
export enum DiffSideName {
    Newer = "newer",
    Marker = "marker",
}

// The box that is open between the info box and the hotkeys box; the keys act on that box.
export enum AppBoxMode {
    Browse = "browse",
    ViewFile = "viewFile",
    Console = "console",
}

export enum JumpSpeed {
    Event = "event",
    Day = "day",
    Week = "week",
}

export enum MarkerDirection {
    TowardsNow = "towardsNow",
    TowardsEarliest = "towardsEarliest",
}

export enum FileWalkStatus {
    Idle = "idle",
    Queued = "queued",
    Running = "running",
    Stopped = "stopped",
    Crashed = "crashed",
}

export enum StepProcessOutcomeKind {
    Covered = "covered",
    Finished = "finished",
    Stopped = "stopped",
    Crashed = "crashed",
}

export enum ScriptAction {
    Refuse = "refuse",
    WaitForKey = "waitForKey",
    RunNow = "runNow",
}

export enum PlayOutcomeKind {
    Replayed = "replayed",
    ReplayRefused = "replay-refused",
    Crashed = "crashed",
}

export enum StepAllRecordKind {
    File = "file",
    Summary = "summary",
}
