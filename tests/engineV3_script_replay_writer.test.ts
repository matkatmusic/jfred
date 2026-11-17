import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { ReplayGapKind, type ReplayGap } from "../engineV3/engineV3_script_replay_gaps.ts";
import { findNewerCommitOfGap, writeReplayedGapIntoInverseRepo } from "../engineV3/engineV3_script_replay_writer.ts";

const FILE_NAME = "a.txt";
const JSONL_PATH = "/logs/session.jsonl";
const TIP_TEXT = "tip text";

function makeTempFolder(t: TestContext): Path {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-script-replay-writer-sparse-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return new Path(folder);
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEvent(type: FileEventType, second: number | undefined, line: number | undefined): FileEvent {
    let instant: Date | undefined;
    if (second !== undefined) {
        instant = makeInstant(second);
    }
    let source: FileEvent["source"];
    if (line !== undefined) {
        source = { filePath: JSONL_PATH, lineNumber: line };
    }
    return { type, instant, source, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
}

function makeState(event: FileEvent, confidence: StateConfidence, text: string | undefined, moment: StateMoment = StateMoment.AtEvent): FileKnownState {
    return { event, moment, confidence, isFileAbsent: text === undefined, text };
}

// A sparse step repo: disk-now at position 0 and a tip commit at position 1.
function makeSparseRepoWithTip(t: TestContext): Path {
    const repoFolder = makeTempFolder(t);
    const diskNowState = makeState(makeEvent(FileEventType.DiskNow, undefined, undefined), StateConfidence.Proven, "now");
    createInverseRepo(repoFolder, FILE_NAME, { state: diskNowState, position: 0 }, makeInstant(100));
    const tipState = makeState(makeEvent(FileEventType.WriteRow, 50, 1), StateConfidence.Proven, TIP_TEXT);
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [{ state: tipState, position: 1 }]);
    return repoFolder;
}

function makeGapBelowPosition(newerPosition: number, droppedPosition: number): ReplayGap {
    const scriptEvent = makeEvent(FileEventType.ScriptMayWrite, 20, 2);
    const droppedState = makeState(scriptEvent, StateConfidence.Unknown, undefined);
    return { kind: ReplayGapKind.Dropped, newerPosition, olderPosition: undefined, droppedStates: [{ state: droppedState, position: droppedPosition }] };
}

test("test_the_newer_commit_of_a_gap_is_the_commit_at_the_newer_position_when_it_exists", (t) => {
    // Scenario: the repo has commits at positions 0 and 1 and the gap sits right below position 1.
    const repoFolder = makeSparseRepoWithTip(t);
    const commits = listInverseCommits(repoFolder, FILE_NAME);
    // The gap newer position is 1.
    const gap = makeGapBelowPosition(1, 2);
    // The newer commit of the gap is the commit at position 1.
    assert.equal(findNewerCommitOfGap(commits, gap)!.position, 1);
});

test("test_the_newer_commit_of_a_gap_is_the_tip_when_the_newer_position_was_skipped", (t) => {
    // Scenario: the repo has commits at positions 0 and 1 and the gap newer position 3 has no commit.
    const repoFolder = makeSparseRepoWithTip(t);
    const commits = listInverseCommits(repoFolder, FILE_NAME);
    const gap = makeGapBelowPosition(3, 4);
    // The newer commit of the gap is the tip at position 1.
    assert.equal(findNewerCommitOfGap(commits, gap)!.position, 1);
});

test("test_a_sparse_gap_write_gives_proven_when_the_replayed_text_equals_the_tip_text", (t) => {
    // Scenario: a step repo has no commit at the gap newer position 3, and the replayed text equals the tip text.
    const repoFolder = makeSparseRepoWithTip(t);
    const gap = makeGapBelowPosition(3, 4);
    // The writer gets the tip text for the dropped position 4.
    const report = writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, new Map<number, string | undefined>([[4, TIP_TEXT]]));
    // The report says equal and Proven.
    assert.equal(report.isEqualToNewerCommit, true);
    assert.equal(report.confidence, StateConfidence.Proven);
    // The commit at position 4 exists with the Proven label and the tip text.
    const commitAtDroppedPosition = listInverseCommits(repoFolder, FILE_NAME).find((inverseCommit) => inverseCommit.position === 4)!;
    assert.equal(commitAtDroppedPosition.confidence, StateConfidence.Proven);
    assert.equal(commitAtDroppedPosition.text, TIP_TEXT);
});
