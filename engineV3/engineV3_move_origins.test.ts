import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { listMoveOriginsNewestFirst } from "./engineV3_move_origins.ts";

const OLD_PATH_ONE = new Path("/project/common/scripts/git.sh");
const OLD_PATH_TWO = new Path("/project/common/scripts/lock.sh");

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEvent(type: FileEventType, second: number | undefined, fields: Partial<FileEvent> = {}): FileEvent {
    let instant: Date | undefined;
    if (second !== undefined) {
        instant = makeInstant(second);
    }
    return { type, instant, source: undefined, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined, ...fields };
}

test("test_listMoveOriginsNewestFirst_gives_nothing_when_no_event_moves_a_file_onto_the_file", () => {
    // Scenario: the file was never the destination of a move or copy.
    // Steps:
    // events newest first: one edit row, one script that may write but moves nothing.
    const events = [makeEvent(FileEventType.EditRow, 9), makeEvent(FileEventType.ScriptMayWrite, 4)];
    // the origin list is empty.
    assert.deepEqual(listMoveOriginsNewestFirst(events), []);
});

test("test_listMoveOriginsNewestFirst_gives_old_path_and_moment_of_the_move", () => {
    // Scenario: a script moved an old path onto the file.
    // Steps:
    // events newest first: an edit row at second 9, the moving script at second 4.
    const events = [makeEvent(FileEventType.EditRow, 9), makeEvent(FileEventType.ScriptMayWrite, 4, { moveOrCopySourceFile: OLD_PATH_ONE })];
    // the origin list holds the old path and second 4, and not the edit row.
    assert.deepEqual(listMoveOriginsNewestFirst(events), [{ oldPath: OLD_PATH_ONE, movedAt: makeInstant(4) }]);
});

test("test_listMoveOriginsNewestFirst_keeps_the_order_of_the_events_when_two_moves_exist", () => {
    // Scenario: two scripts moved two old paths onto the same file, one after the other.
    // Steps:
    // events newest first: the move of second 8, then the move of second 2.
    const events = [
        makeEvent(FileEventType.ScriptMayWrite, 8, { moveOrCopySourceFile: OLD_PATH_TWO }),
        makeEvent(FileEventType.ScriptMayWrite, 2, { moveOrCopySourceFile: OLD_PATH_ONE }),
    ];
    // the origin list is newest first as well.
    assert.deepEqual(listMoveOriginsNewestFirst(events), [
        { oldPath: OLD_PATH_TWO, movedAt: makeInstant(8) },
        { oldPath: OLD_PATH_ONE, movedAt: makeInstant(2) },
    ]);
});

test("test_listMoveOriginsNewestFirst_throws_when_a_move_event_has_no_instant", () => {
    // Scenario: a move event without an instant cannot be placed in time.
    // Steps:
    // one move event with an undefined instant.
    const events = [makeEvent(FileEventType.ScriptMayWrite, undefined, { moveOrCopySourceFile: OLD_PATH_ONE })];
    // the function throws.
    assert.throws(() => listMoveOriginsNewestFirst(events), /no instant/);
});
