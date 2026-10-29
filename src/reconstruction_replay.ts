// Replay: turn a file's ordered events into its revisions. See reconstruction_engine.ts.

import { EventKind } from "./structures/vocabulary.ts";
import { applyEdit, isFilePresent } from "./reconstruction_replay_edit.ts";
import {
  appendRevision,
  copyRevision,
  createDeleteRevision,
  createScriptExecutionRevision,
  createUnrecoverableRevision,
  createUserEditRevision,
  isUserEditChangingContent,
  renameRevision,
  writeRevision,
} from "./reconstruction_replay_revisions.ts";
import type { FileEvent, FileRevision } from "./reconstruction_events.ts";

// Thrown for an event kind replay cannot apply, so an unmodeled kind never passes silently.
export class UnsupportedEventKindError extends Error {
  readonly kind: string;

  constructor(kind: string) {
    super(`Unsupported event kind in replay: ${kind}`);
    this.name = "UnsupportedEventKindError";
    this.kind = kind;
  }
}

function appendRevisionsForEvent(
  event: FileEvent,
  revisions: FileRevision[],
): void {
  if (event.kind === EventKind.write) {
    revisions.push(writeRevision(event, isFilePresent(revisions)));
    return;
  }
  if (event.kind === EventKind.delete) {
    revisions.push(createDeleteRevision(event));
    return;
  }
  if (event.kind === EventKind.edit) {
    applyEdit(event, revisions);
    return;
  }
  if (event.kind === EventKind.rename) {
    revisions.push(renameRevision(event, revisions));
    return;
  }
  if (event.kind === EventKind.copy) {
    revisions.push(copyRevision(event));
    return;
  }
  if (event.kind === EventKind.overwrite) {
    revisions.push(writeRevision(event, isFilePresent(revisions)));
    return;
  }
  if (event.kind === EventKind.append) {
    revisions.push(appendRevision(event, revisions, isFilePresent(revisions)));
    return;
  }
  if (event.kind === EventKind.userEdit) {
    const changesContent = isUserEditChangingContent(event, revisions);
    if (changesContent) {
      revisions.push(createUserEditRevision(event));
    }
    return;
  }
  if (event.kind === EventKind.scriptExecution) {
    revisions.push(createScriptExecutionRevision(event));
    return;
  }
  throw new UnsupportedEventKindError((event as { kind: string }).kind);
}

// Replay events in order; a throwing event becomes an unrecoverable placeholder, later events still replay.
export function collectRevisions(events: FileEvent[]): FileRevision[] {
  const revisions: FileRevision[] = [];
  for (const event of events) {
    try {
      appendRevisionsForEvent(event, revisions);
    }
    catch (error) {
      revisions.push(createUnrecoverableRevision(event, revisions, String(error)));
    }
  }
  return revisions;
}
