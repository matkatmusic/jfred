// Revision builders for each replayed event kind.

import { EventKind } from "./structures/vocabulary.ts";
import { splitLines, createGenesisLines, copyLinesForward, getLastLines, isFilePresent } from "./reconstruction_replay_edit.ts";
import type { AppendEvent, CopyEvent, DeleteEvent, FileEvent, FileRevision, OverwriteEvent, RenameEvent, UserEditEvent, WriteEvent } from "./reconstruction_events.ts";
import type { ScriptExecutionEvent } from "./reconstruction_script_execution.ts";

// A write on an absent file creates; on a present file it overwrites. Content is all genesis.
export function writeRevision(event: WriteEvent | OverwriteEvent, replacesPresent: boolean): FileRevision {
  return {
    kind: replacesPresent ? EventKind.overwrite : EventKind.write,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: createGenesisLines(splitLines(event.content), event.timestamp),
  };
}

export function createDeleteRevision(event: DeleteEvent): FileRevision {
  return {
    kind: EventKind.delete,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: [],
  };
}

// A rename carries the prior lines forward unchanged and records the from/to paths.
export function renameRevision(event: RenameEvent, revisions: FileRevision[]): FileRevision {
  return {
    kind: EventKind.rename,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: copyLinesForward(getLastLines(revisions)),
    rename: { from: event.from, to: event.to },
  };
}

// A copy is a new file born with the source's content at copy time; the source is untouched.
export function copyRevision(event: CopyEvent): FileRevision {
  return {
    kind: EventKind.copy,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: createGenesisLines(event.seedLines, event.timestamp),
    copy: { from: event.from, to: event.to },
  };
}

// A user's out-of-band edit: full-content genesis lines, kept as user-edit for attribution.
export function createUserEditRevision(event: UserEditEvent): FileRevision {
  return {
    kind: EventKind.userEdit,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: createGenesisLines(splitLines(event.content), event.timestamp),
  };
}

// A script run: precomputed full-content genesis lines, kept as script-execution for attribution.
export function createScriptExecutionRevision(event: ScriptExecutionEvent): FileRevision {
  return {
    kind: EventKind.scriptExecution,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: createGenesisLines(splitLines(event.content), event.timestamp),
  };
}

// A survived per-event failure: the prior lines carried forward, flagged with the reason.
export function createUnrecoverableRevision(event: FileEvent, revisions: FileRevision[], reason: string): FileRevision {
  return {
    kind: event.kind,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: copyLinesForward(getLastLines(revisions)),
    unrecoverable: { reason },
  };
}

// A `>>` append keeps a present file's lines and adds the new tail; on an absent file it creates.
export function appendRevision(event: AppendEvent, revisions: FileRevision[], present: boolean): FileRevision {
  const newLines = splitLines(event.content);
  if (!present) {
    return {
      kind: EventKind.write,
      changeId: event.changeId,
      timestamp: event.timestamp,
      lines: createGenesisLines(newLines, event.timestamp),
    };
  }
  const carried = copyLinesForward(getLastLines(revisions));
  const appended = createGenesisLines(newLines.slice(carried.length), event.timestamp);
  return {
    kind: EventKind.append,
    changeId: event.changeId,
    timestamp: event.timestamp,
    lines: [...carried, ...appended],
  };
}

function getLatestTexts(revisions: FileRevision[]): string[] {
  const texts: string[] = [];
  for (const entry of getLastLines(revisions)) {
    texts.push(entry.values[entry.values.length - 1]!.line);
  }
  return texts;
}

// A user edit that matches the current file text records no change and is dropped.
export function isUserEditChangingContent(event: UserEditEvent, revisions: FileRevision[]): boolean {
  const isPresent = isFilePresent(revisions);
  if (!isPresent) {
    return true;
  }
  const current = getLatestTexts(revisions);
  const next = splitLines(event.content);
  if (current.length !== next.length) {
    return true;
  }
  for (let index = 0; index < current.length; index++) {
    if (current[index] !== next[index]) {
      return true;
    }
  }
  return false;
}
