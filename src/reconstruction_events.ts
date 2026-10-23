// Event and revision value types for the reconstruction model.

import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import type { ScriptExecutionEvent } from "./reconstruction_script_execution.ts";

// --- The per-line model ------------------------------------------------------

// A single sighting of a line's content at a point in time.
export type LineValue = { line: string; timestamp: Date };

// oldLineNum back-points to the previous revision; DOES_NOT_EXIST_YET = born here.
export type LineEntry = { oldLineNum: number; values: LineValue[] };

// The source and destination of a rename (the two paths an mv connects).
export type RenameInfo = { from: Path; to: Path };

// Like RenameInfo but a copy duplicates; a rename moves.
export type CopyInfo = { from: Path; to: Path };

// Whole-file snapshot; rename/copy fields set only on those revision kinds.
export type FileRevision = {
  kind: EventKind;
  changeId: Uuid;
  timestamp: Date;
  lines: LineEntry[];
  rename?: RenameInfo;
  copy?: CopyInfo;
  // Set when replay threw; lines are carried forward from the previous revision.
  unrecoverable?: { reason: string };
};

// One file's reconstructed history.
export type FileHistory = { target: Path; revisions: FileRevision[] };

// --- Events: one per piece of evidence ---------------------------------------

export type WriteEvent = {
  kind: EventKind.write;
  changeId: Uuid;
  target: Path;
  content: string;
  timestamp: Date;
};

export type DeleteEvent = {
  kind: EventKind.delete;
  changeId: Uuid;
  target: Path;
  timestamp: Date;
};

// originalFile is the pre-edit disk content, used to recover out-of-hunk-window appends (s40).
export type EditEvent = {
  kind: EventKind.edit;
  changeId: Uuid;
  target: Path;
  hunks: StructuredPatchHunk[];
  originalFile?: string | null;
  timestamp: Date;
};

// A rename (Bash mv): the file's history continues at `to`, carrying its lines.
export type RenameEvent = {
  kind: EventKind.rename;
  changeId: Uuid;
  from: Path;
  to: Path;
  timestamp: Date;
};

// seedLines: empty from extraction, filled during reconstruction from the source file.
export type CopyEvent = {
  kind: EventKind.copy;
  changeId: Uuid;
  from: Path;
  to: Path;
  seedLines: string[];
  timestamp: Date;
};

// content: full post-append text from sidecar; empty from extraction, filled during replay.
export type AppendEvent = {
  kind: EventKind.append;
  changeId: Uuid;
  target: Path;
  content: string;
  timestamp: Date;
};

// Bash `>` redirect; content recovered from sidecar like AppendEvent.
export type OverwriteEvent = {
  kind: EventKind.overwrite;
  changeId: Uuid;
  target: Path;
  content: string;
  timestamp: Date;
};

// Out-of-band disk edit from `edited_text_file` attachment; distinct kind preserves provenance.
export type UserEditEvent = {
  kind: EventKind.userEdit;
  changeId: Uuid;
  target: Path;
  content: string;
  timestamp: Date;
};

export type FileEvent =
    | WriteEvent
    | DeleteEvent
    | EditEvent
    | RenameEvent
    | CopyEvent
    | AppendEvent
    | OverwriteEvent
    | UserEditEvent
    | ScriptExecutionEvent;
