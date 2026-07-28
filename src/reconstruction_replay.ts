// Replay: turn a file's ordered events into its revisions. Each event appends one or more revisions and may read the previous one (an Edit emits a removal then an addition). The event/revision model lives in reconstruction_engine.ts; extraction (records -> events) lives there too. Design: reconstruction_engine.ts.

import { EventKind } from "./structures/vocabulary.ts";
import {
    splitLines,
    genesisLine,
    carryAt,
    lastLinesOf,
    fileIsPresent,
    applyEdit,
    appendRevision,
} from "./reconstruction_replay_edit.ts";
import type {
    CopyEvent,
    DeleteEvent,
    FileEvent,
    FileRevision,
    OverwriteEvent,
    RenameEvent,
    UserEditEvent,
    WriteEvent,
} from "./reconstruction_engine.ts";
import type { ScriptExecutionEvent } from "./reconstruction_script_execution.ts";

// Thrown when replay meets an event kind it cannot apply, so an unmodeled kind cannot pass silently (fog-of-war guard; mirrors UnknownToolNameError).  replayEvents catches it into a visible unrecoverable placeholder revision.
export class UnsupportedEventKindError extends Error {
    readonly kind: string;

    constructor(kind: string) {
        super(`Unsupported event kind in replay: ${kind}`);
        this.name = "UnsupportedEventKindError";
        this.kind = kind;
    }
}

// A write produces a create when the file is absent, or an overwrite when it is already present. Either way the new content is genesis (every line born here): an overwrite replaces all content, it does not splice (locked decision 1). A bash `>` redirect routes here too as an OverwriteEvent (both carry content).
function writeRevision(event: WriteEvent | OverwriteEvent, replacesPresent: boolean): FileRevision {
    const lines = splitLines(event.content).map((line) =>
        genesisLine(line, event.timestamp),
    );
    return {
        kind: replacesPresent ? EventKind.overwrite : EventKind.write,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines,
    };
}

function deleteRevision(event: DeleteEvent): FileRevision {
    return {
        kind: EventKind.delete,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines: [],
    };
}

// A rename is a first-class entry: it carries the prior lines forward unchanged (identity back-pointers) and records the from/to paths. It mints no line change.
function renameRevision(
    event: RenameEvent,
    revisions: FileRevision[],
): FileRevision {
    const lines = lastLinesOf(revisions).map(carryAt);
    return {
        kind: EventKind.rename,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines,
        rename: { from: event.from, to: event.to },
    };
}

// A copy is a first-class genesis entry: a NEW file born with the source's content as of the copy (seedLines), every line genesis (oldLineNum DOES_NOT_EXIST_YET) stamped at the copy timestamp, recording the from/to provenance. The source file is untouched.
function copyRevision(event: CopyEvent): FileRevision {
    const lines = event.seedLines.map((line) =>
        genesisLine(line, event.timestamp),
    );
    return {
        kind: EventKind.copy,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines,
        copy: { from: event.from, to: event.to },
    };
}

// A user's out-of-band edit: a wholesale full-content revision (the snippet carried the entire post-edit file). Like an overwrite it replaces all content — every line genesis — but keeps the `user-edit` kind so the render attributes it to the user, not an agent write.
function userEditRevision(event: UserEditEvent): FileRevision {
    const lines = splitLines(event.content).map((line) =>
        genesisLine(line, event.timestamp),
    );
    return {
        kind: EventKind.userEdit,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines,
    };
}

// A script-execution run: a wholesale full-content revision (every line genesis), like userEdit/ overwrite, but kept its own `script-execution` kind so the render attributes it to the recorded script run rather than an agent write. `content` is the precomputed post-script state (the forward transform already applied), so the revision is independent of replay ordering.
function scriptExecutionRevision(event: ScriptExecutionEvent): FileRevision {
    const lines = splitLines(event.content).map((line) => genesisLine(line, event.timestamp));
    return {
        kind: EventKind.scriptExecution,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines,
    };
}

// The believed current text of a file: the latest value of each line in its last revision.
function currentText(revisions: FileRevision[]): string[] {
    return lastLinesOf(revisions).map(
        (entry) => entry.values[entry.values.length - 1]!.line,
    );
}

// Whether a user edit actually changes the file: true when the file is absent, or the snippet's lines differ from the file's current lines. An `edited_text_file` attachment is the IDE echoing a file's content whenever it is written OR read, so a snapshot that matches the current content records NO change and is dropped — the goal is to reconstruct every real change, not to log redundant snapshots (an agent-write echo in s5/s13 matches disk; a genuine user edit in s15 differs). See plans/s15/s15-reconstruction-plan.md.
function userEditChangesContent(event: UserEditEvent, revisions: FileRevision[]): boolean {
    if (!fileIsPresent(revisions)) {
        return true;
    }
    const current = currentText(revisions);
    const next = splitLines(event.content);
    if (current.length !== next.length) {
        return true;
    }
    return current.some((line, index) => line !== next[index]);
}

function appendRevisionsForEvent(
    event: FileEvent,
    revisions: FileRevision[],
): void {
    if (event.kind === EventKind.write) {
        revisions.push(writeRevision(event, fileIsPresent(revisions)));
        return;
    }
    if (event.kind === EventKind.delete) {
        revisions.push(deleteRevision(event));
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
        revisions.push(writeRevision(event, fileIsPresent(revisions)));
        return;
    }
    if (event.kind === EventKind.append) {
        revisions.push(appendRevision(event, revisions, fileIsPresent(revisions)));
        return;
    }
    if (event.kind === EventKind.userEdit) {
        if (userEditChangesContent(event, revisions)) {
            revisions.push(userEditRevision(event));
        }
        return;
    }
    if (event.kind === EventKind.scriptExecution) {
        revisions.push(scriptExecutionRevision(event));
        return;
    }
    throw new UnsupportedEventKindError((event as { kind: string }).kind);
}

// A survived per-event failure: the revision slot exists (so steppers and coverage strips can show the gap) but its lines are the prior state carried forward, flagged with the reason.
function unrecoverableRevision(event: FileEvent, revisions: FileRevision[], reason: string): FileRevision {
    return {
        kind: event.kind,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines: lastLinesOf(revisions).map(carryAt),
        unrecoverable: { reason },
    };
}

// Replay events in order into revisions; an event may append more than one (an Edit emits a removal then an addition) and may read the previous one.  An event whose replay throws (an UnsupportedEventKindError included) becomes an unrecoverable placeholder revision instead of killing the file, so every later event still replays against the believed state.
export function replayEvents(events: FileEvent[]): FileRevision[] {
    const revisions: FileRevision[] = [];
    for (const event of events) {
        try {
            appendRevisionsForEvent(event, revisions);
        } catch (error) {
            revisions.push(unrecoverableRevision(event, revisions, String(error)));
        }
    }
    return revisions;
}

