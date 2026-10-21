// View-facing enums split from vocabulary.ts: node kinds, verdicts, branch roles, response kinds.

// Node classes: beacon = verified content; preAnchorStub = byteless; presumedUserEdit = unexplained adjacent-pair diff.
export enum LayeredNodeKind {
  beacon = "beacon",
  preAnchorStub = "pre-anchor-stub",
  endState = "end-state",
  presumedUserEdit = "presumed-user-edit",
  scriptRun = "script-run",
}

export const KNOWN_LAYERED_NODE_KINDS: LayeredNodeKind[] = Object.values(LayeredNodeKind);

// Endpoint matches are necessary but NOT sufficient: a ladder with unrecoverable revisions still has gaps.
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

// The surviving branch holds the on-disk working tree; a rewound branch forked at a rewind point and was abandoned.
export enum BranchRole {
  surviving = "surviving",
  rewound = "rewound",
}

// The /api/document payload's discriminant: build it, or first ask the user to consent to running the transcript's scripts.
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
