// The step after a replay: a restart whose tip sits inside a gap, and the replayed texts accepted into a live step.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome, ToolName } from "../src/structures/vocabulary.ts";
import type { EditRow, WriteRow } from "../engineV3/engineV3_replay_reverse.ts";
import { FileEventType, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { StateConfidence, StateMoment, listKnownStatesForFile } from "../engineV3/engineV3_file_known_states.ts";
import { createFileStep, stepFileToNextTextChange, type FileStep, type FileStepResult, type WrittenCommit } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { acceptReplayedTexts } from "../engineV3/engineV3_file_step_replay.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits, type OrderedKnownState } from "../engineV3/engineV3_inverse_repo.ts";
import { listReplayGapsFromStates, type ReplayGap } from "../engineV3/engineV3_script_replay_gaps.ts";

const FILE_NAME = "f.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

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

function makeDiskNowEvent(text: string): FileEvent {
    return makeEvent(FileEventType.DiskNow, undefined, { bytes: text });
}

function makeGitCommitEvent(second: number, text: string): FileEvent {
    return makeEvent(FileEventType.GitCommit, second, { bytes: text });
}

function makeMayWriteScriptEvent(second: number): FileEvent {
    return makeEvent(FileEventType.ScriptMayWrite, second);
}

function makePartialEditEvent(second: number, oldString: string, newString: string): FileEvent {
    const row: EditRow = { toolName: ToolName.Edit, timestamp: makeInstant(second), source: undefined, oldString, newString, replaceAll: false, originalFile: undefined };
    return makeEvent(FileEventType.EditRow, second, { row });
}

function makeWrittenCommitForEvents(events: FileEvent[], position: number, confidence: StateConfidence, text: string | undefined): WrittenCommit {
    const replayedState = listKnownStatesForFile(events)[position]!;
    return { position, confidence, isFileAbsent: replayedState.isFileAbsent, text, eventType: replayedState.event.type, moment: replayedState.moment };
}

function summarizeResult(result: FileStepResult) {
    return { outcome: result.outcome, engine: result.engine, eventType: result.eventType, position: result.writtenState?.position, text: result.writtenState?.state.text, changedLabels: result.changedLabels };
}

test("test_a_queued_state_at_or_below_the_tip_is_never_judged", () => {
    // Scenario: DiskNow "abc", then three git commits "second", "third", "fourth"; the stored tip is position 3 ("fourth").
    const events = [makeDiskNowEvent("abc"), makeGitCommitEvent(30, "second"), makeGitCommitEvent(20, "third"), makeGitCommitEvent(10, "fourth")];
    const storedCommits = [makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, "abc"), makeWrittenCommitForEvents(events, 3, StateConfidence.Proven, "fourth")];
    const step = createFileStep(events, storedCommits);
    // A queued state at position 2 has the text "third", which differs from the tip text "fourth".
    step.queue.push({ position: 2, passIndex: 2, engine: undefined, isRoadblockEntry: false });
    // Step once.
    const result = stepFileToNextTextChange(step, undefined);
    // The state at position 2 is not written: nothing is older than the tip.
    assert.equal(result.writtenState, undefined);
    assert.equal(result.outcome, InverseStepOutcome.NoOlderChange);
});

test("test_a_restart_with_the_tip_inside_a_gap_settles_the_gap_and_does_not_throw", () => {
    // Scenario: DiskNow "abc", a script that may write at second 20, a git commit "zzz" at second 10.
    const events = [makeDiskNowEvent("abc"), makeMayWriteScriptEvent(20), makeGitCommitEvent(10, "zzz")];
    // The replay wrote the text "xyz" at position 1, which is the script state (carried text "abc").
    const storedCommits: WrittenCommit[] = [
        makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, "abc"),
        { position: 1, confidence: StateConfidence.Proven, isFileAbsent: false, text: "xyz", eventType: FileEventType.ScriptMayWrite, moment: StateMoment.AtEvent },
    ];
    // Creating the step does not throw: the git commit text "zzz" settles the script state to Unknown.
    assert.doesNotThrow(() => createFileStep(events, storedCommits));
});

test("test_a_restart_with_the_tip_inside_a_gap_but_a_wrong_non_gap_text_still_throws", () => {
    // Scenario: the same events; the stored tip is position 2 (the git commit) with a text the replay does not give.
    const events = [makeDiskNowEvent("abc"), makeMayWriteScriptEvent(20), makeGitCommitEvent(10, "zzz")];
    const storedCommits = [makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, "abc"), makeWrittenCommitForEvents(events, 2, StateConfidence.Proven, "wrong")];
    // Creating the step throws the start-again message.
    assert.throws(() => createFileStep(events, storedCommits), /does not match the replayed state/);
});

test("test_a_restart_after_a_normal_write_gives_the_same_next_result_as_an_unbroken_run", () => {
    // Scenario: DiskNow, an Edit at 40, a script at 30, an Edit at 20 that can be undone, a git commit "zzz" at 10.
    const events = [
        makeDiskNowEvent("one TWO three"),
        makePartialEditEvent(40, "two", "TWO"),
        makeMayWriteScriptEvent(30),
        makePartialEditEvent(20, "tw", "two"),
        makeGitCommitEvent(10, "zzz"),
    ];
    const clicksAfterTheWrite = 3;
    // Run A (unbroken): the first click writes the Edit at 40 as a Derived commit at position 2.
    const unbrokenStep = createFileStep(events, [makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, "one TWO three")]);
    const firstResult = stepFileToNextTextChange(unbrokenStep, undefined);
    assert.equal(firstResult.writtenState!.position, 2);
    assert.equal(firstResult.writtenState!.state.confidence, StateConfidence.Derived);
    const unbrokenResults: ReturnType<typeof summarizeResult>[] = [];
    for (let clickNumber = 0; clickNumber < clicksAfterTheWrite; clickNumber += 1) {
        unbrokenResults.push(summarizeResult(stepFileToNextTextChange(unbrokenStep, undefined)));
    }
    // Run B: a new step is made from the stored commits of that write (a restart), then clicked the same number of times.
    const restartedStep: FileStep = createFileStep(events, [
        makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, "one TWO three"),
        makeWrittenCommitForEvents(events, 2, StateConfidence.Derived, "one two three"),
    ]);
    const restartedResults: ReturnType<typeof summarizeResult>[] = [];
    for (let clickNumber = 0; clickNumber < clicksAfterTheWrite; clickNumber += 1) {
        restartedResults.push(summarizeResult(stepFileToNextTextChange(restartedStep, undefined)));
    }
    // The restarted run gives the same results as the unbroken run.
    assert.deepEqual(restartedResults, unbrokenResults);
    // The unbroken run writes the Edit at 20 (a NewText stop) after the script stop, so the comparison is not empty.
    assert.equal(unbrokenResults[0]!.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(unbrokenResults[1]!.outcome, InverseStepOutcome.NewText);
});

function makeWriteEvent(second: number, content: string): FileEvent {
    const row: WriteRow = { toolName: ToolName.Write, timestamp: makeInstant(second), source: undefined, isCreate: true, content, originalFile: undefined };
    return makeEvent(FileEventType.WriteRow, second, { row });
}

// Newest first: DiskNow "v1", a script at 20 (position 1), an Edit "zz" to "v1" at 15 (positions 2 and 3), a Write "v0" at 10 (position 4).
function makeEventsWithOneGap(): FileEvent[] {
    return [makeDiskNowEvent("v1\n"), makeMayWriteScriptEvent(20), makePartialEditEvent(15, "zz", "v1"), makeWriteEvent(10, "v0\n")];
}

// The step is clicked once, so it stands on the script state at position 1; the gap holds positions 1, 2 and 3.
function createStepStoppedOnTheScript(events: FileEvent[]): { step: FileStep; gap: ReplayGap } {
    const step = createFileStep(events, [makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, "v1\n")]);
    const stopResult = stepFileToNextTextChange(step, undefined);
    assert.equal(stopResult.outcome, InverseStepOutcome.UnknownOrRoadblock);
    const gap = listReplayGapsFromStates(listKnownStatesForFile(events))[0]!;
    assert.deepEqual(gap.droppedStates.map((droppedState) => droppedState.position), [1, 2, 3]);
    assert.equal(gap.olderPosition, 4);
    return { step, gap };
}

function makeReplayedTexts(): Map<number, string | undefined> {
    return new Map<number, string | undefined>([[1, "v1\n"], [2, "v1\n"], [3, "zz\n"]]);
}

test("test_after_accepting_a_replay_the_next_click_does_not_collide_with_the_replay_commits", (t: TestContext) => {
    // Scenario: disk "v1", a script, an Edit "zz" to "v1", a Write "v0"; the step stands on the script state.
    const events = makeEventsWithOneGap();
    const { step, gap } = createStepStoppedOnTheScript(events);
    const tempFolder = mkdtempSync(join(tmpdir(), "engine-v3-file-step-replay-"));
    t.after(() => rmSync(tempFolder, { recursive: true, force: true }));
    const repoFolder = new Path(join(tempFolder, "repo"));
    createInverseRepo(repoFolder, FILE_NAME, { state: listKnownStatesForFile(events)[0]!, position: 0 }, DISK_NOW_INSTANT);
    // The replay writes commits for positions 1 to 3.
    const replayedTexts = makeReplayedTexts();
    const replayedStates: OrderedKnownState[] = gap.droppedStates.map((droppedState) => ({
        state: { event: droppedState.state.event, moment: droppedState.state.moment, confidence: StateConfidence.Derived, isFileAbsent: false, text: replayedTexts.get(droppedState.position) },
        position: droppedState.position,
    }));
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, replayedStates);
    // The step accepts the replayed texts.
    acceptReplayedTexts(step, gap, replayedTexts);
    // The next click does not throw and writes position 4, the first state above the gap.
    const written = stepFileAndWriteCommit(repoFolder, FILE_NAME, step, undefined);
    assert.equal(written.result.writtenState!.position, 4);
    assert.equal(written.result.writtenState!.state.text, "v0\n");
    assert.deepEqual(listInverseCommits(repoFolder, FILE_NAME, false).map((commit) => commit.position), [0, 1, 2, 3, 4]);
});

test("test_accepting_throws_when_a_dropped_position_is_not_above_the_tip", () => {
    // Scenario: the step stands on the script state, and the tip is moved to position 2 by hand.
    const { step, gap } = createStepStoppedOnTheScript(makeEventsWithOneGap());
    step.lastWrittenPosition = 2;
    // Accepting throws because the dropped position 1 is not above the tip.
    assert.throws(() => acceptReplayedTexts(step, gap, makeReplayedTexts()), /dropped position 1 is not above the tip 2/);
});

test("test_accepting_clears_queued_states_inside_the_gap", () => {
    // Scenario: the step stands on the script state; queued states sit at positions 2, 3 and 4.
    const { step, gap } = createStepStoppedOnTheScript(makeEventsWithOneGap());
    for (const position of [2, 3, 4]) {
        step.queue.push({ position, passIndex: 2, engine: undefined, isRoadblockEntry: false });
    }
    // The step accepts the replayed texts.
    acceptReplayedTexts(step, gap, makeReplayedTexts());
    // Only the queued state above the gap is left.
    assert.deepEqual(step.queue.map((queuedState) => queuedState.position), [4]);
});
