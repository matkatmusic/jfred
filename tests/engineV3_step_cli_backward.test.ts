// The backward move of the step command loop: one function that moves the position history back by one.

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { createInverseRepo, insertStatesIntoInverseRepo, type OrderedKnownState } from "../engineV3/engineV3_inverse_repo.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { moveBackwardInPositionHistory } from "../engineV3/engineV3_step_cli.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const FILE_NAME = "a.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeOrderedState(position: number, second: number | undefined, text: string): OrderedKnownState {
    let eventType = FileEventType.GitCommit;
    let instant: Date | undefined;
    if (second === undefined) {
        eventType = FileEventType.DiskNow;
    } else {
        instant = makeInstant(second);
    }
    const event = { type: eventType, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
    const state: FileKnownState = { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, isFileAbsent: false, text };
    return { state, position };
}

// An inverse repo of a.txt holding the stored positions 0 (disk now), 1 and 2.
function makeRepoWithThreePositions(t: TestContext): Path {
    const rootFolder = createTempDir();
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const repoFolder = new Path(join(rootFolder, `${FILE_NAME}.git`));
    createInverseRepo(repoFolder, FILE_NAME, makeOrderedState(0, undefined, "now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [
        makeOrderedState(1, 200, "two\n"),
        makeOrderedState(2, 100, "one\n"),
    ]);
    return repoFolder;
}

test("test_moveBackwardInPositionHistory_pops_one_position_and_gives_moved_back", (t) => {
    // The position history holds the positions 0 and 1.
    const repoFolder = makeRepoWithThreePositions(t);
    const positionHistory = [0, 1];
    // The backward move runs once.
    const result = moveBackwardInPositionHistory(positionHistory, repoFolder, FILE_NAME);
    // The history lost its last position, the outcome is MovedBack, and the stored commit is the one of position 0.
    assert.deepEqual(positionHistory, [0]);
    assert.equal(result.outcome, InverseStepOutcome.MovedBack);
    assert.equal(result.position, 0);
    assert.equal(result.storedCommit!.position, 0);
});

test("test_moveBackwardInPositionHistory_at_the_bottom_gives_no_newer_change_and_keeps_the_position", (t) => {
    // The position history holds only the position 1.
    const repoFolder = makeRepoWithThreePositions(t);
    const positionHistory = [1];
    // The backward move runs once.
    const result = moveBackwardInPositionHistory(positionHistory, repoFolder, FILE_NAME);
    // The history is the same, the outcome is NoNewerChange, and the stored commit is the one of position 1.
    assert.deepEqual(positionHistory, [1]);
    assert.equal(result.outcome, InverseStepOutcome.NoNewerChange);
    assert.equal(result.position, 1);
    assert.equal(result.storedCommit!.position, 1);
});

test("test_moveBackwardInPositionHistory_gives_an_undefined_commit_when_no_stored_commit_has_the_position", (t) => {
    // The position history holds only the position 7, and no stored commit has the position 7.
    const repoFolder = makeRepoWithThreePositions(t);
    const positionHistory = [7];
    // The backward move runs once.
    const result = moveBackwardInPositionHistory(positionHistory, repoFolder, FILE_NAME);
    // The position is 7 and the stored commit is undefined.
    assert.equal(result.position, 7);
    assert.equal(result.storedCommit, undefined);
});
