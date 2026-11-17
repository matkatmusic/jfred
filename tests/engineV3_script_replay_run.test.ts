import { test } from "node:test";
import assert from "node:assert/strict";

import { Path, Uuid } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { listKnownStatesForFile } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType, createEvent, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { convertScriptRunToTaskRecord, listReplayGapsFromStates } from "../engineV3/engineV3_script_replay_gaps.ts";
import { ScriptTaskOutcomeKind, replaySingleGapInContainer, type SingleGapReplayInput } from "../engineV3/engineV3_script_replay_run.ts";
import { ScriptReplayTaskReason, type ScriptReplayTask } from "../engineV3/engineV3_script_replay_tasks.ts";
import { ReplayWorkspace } from "../engineV3/engineV3_script_replay_workspace.ts";

const JSONL_PATH = "/logs/session.jsonl";
const STORE_FOLDER = new Path("/store");
const PROJECT_FOLDER = new Path("/project");
const REPLAYED_FILE = new Path("/project/f.txt");
const RELATIVE_PATH = "f.txt";

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeSource(line: number): { filePath: string; lineNumber: number } {
    return { filePath: JSONL_PATH, lineNumber: line };
}

function makeDiskNowEvent(text: string): FileEvent {
    return createEvent(FileEventType.DiskNow, undefined, undefined, { bytes: text });
}

function makeWriteEvent(second: number, content: string): FileEvent {
    const row = { toolName: ToolName.Write as const, timestamp: makeInstant(second), source: makeSource(second), isCreate: true, content, originalFile: undefined };
    return createEvent(FileEventType.WriteRow, makeInstant(second), makeSource(second), { row });
}

function makeEditEvent(second: number, oldString: string, newString: string): FileEvent {
    const row = { toolName: ToolName.Edit as const, timestamp: makeInstant(second), source: makeSource(second), oldString, newString, replaceAll: false, originalFile: undefined };
    return createEvent(FileEventType.EditRow, makeInstant(second), makeSource(second), { row });
}

function makeScriptRun(second: number, overrides: Partial<ScriptRun> = {}): ScriptRun {
    return {
        code: "printf 'v1\\n' > f.txt",
        timestamp: makeInstant(second),
        cwd: PROJECT_FOLDER,
        source: makeSource(second),
        toolUseId: new Uuid(`toolu_${second}`),
        executorKind: ScriptExecutorKind.bash,
        runInBackground: false,
        ...overrides,
    };
}

function makeScriptEvent(scriptRun: ScriptRun): FileEvent {
    return createEvent(FileEventType.ScriptMayWrite, scriptRun.timestamp, scriptRun.source, { scriptRun });
}

function makeTaskForScriptRun(scriptRun: ScriptRun): ScriptReplayTask {
    return {
        record: convertScriptRunToTaskRecord(scriptRun),
        instant: scriptRun.timestamp,
        waitingFiles: [{ relativePath: RELATIVE_PATH, reason: ScriptReplayTaskReason.NamedByFile }],
    };
}

function makeSingleGapInput(eventsNewestToOldest: FileEvent[], tasks: ScriptReplayTask[], startText: string | undefined): SingleGapReplayInput {
    const projectFiles = [{ file: REPLAYED_FILE, transcriptFile: new Path(JSONL_PATH) }];
    const gap = listReplayGapsFromStates(listKnownStatesForFile(eventsNewestToOldest))[0]!;
    return {
        settings: { projectFolder: PROJECT_FOLDER, recordedProjectFolder: PROJECT_FOLDER, projectFiles, jsonlsFolders: [], snapshotFolders: [], storeFolder: STORE_FOLDER },
        workspace: new ReplayWorkspace(STORE_FOLDER, PROJECT_FOLDER, PROJECT_FOLDER, projectFiles),
        tasks,
        gap,
        startText,
        fileIndex: 0,
    };
}

test("test_a_refused_script_gives_no_texts_and_the_refusal_reason", async () => {
    // Scenario: the only event of the gap is a script that runs in the background, so the run module refuses it before any container call.
    const backgroundScriptRun = makeScriptRun(20, { runInBackground: true });
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(backgroundScriptRun), makeWriteEvent(10, "v0\n")];
    const input = makeSingleGapInput(events, [makeTaskForScriptRun(backgroundScriptRun)], "v0\n");
    // Replay the gap.
    const result = await replaySingleGapInContainer(input, () => {}, new AbortController().signal);
    // No texts come back.
    assert.equal(result.textByPosition, undefined);
    // The reason is the refusal of the run module.
    assert.equal(result.failureReason, "the script runs in the background");
    // The outcome of the task is refused.
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0]!.outcome, ScriptTaskOutcomeKind.Refused);
});

test("test_a_gap_edit_that_does_not_apply_forward_gives_no_texts_and_a_reason", async () => {
    // Scenario: an Edit of the gap has an old string "zz" that the start text "v0\n" does not hold, and a script follows the Edit.
    const scriptRun = makeScriptRun(20);
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(scriptRun), makeEditEvent(15, "zz", "v1"), makeWriteEvent(10, "v0\n")];
    const input = makeSingleGapInput(events, [makeTaskForScriptRun(scriptRun)], "v0\n");
    // Replay the gap.
    const result = await replaySingleGapInContainer(input, () => {}, new AbortController().signal);
    // No texts come back.
    assert.equal(result.textByPosition, undefined);
    // The reason names the Edit.
    assert.equal(result.failureReason, "an Edit of the gap does not apply forward to the running text");
    // The script never ran: its outcome is the not-needed refusal.
    assert.equal(result.outcomes[0]!.outcome, ScriptTaskOutcomeKind.Refused);
    assert.equal(result.outcomes[0]!.reason, "no unfilled gap needed this script");
});
