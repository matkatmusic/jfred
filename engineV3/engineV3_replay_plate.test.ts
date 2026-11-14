import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { PlateEventName, getPlateEventName, listPlateRuns } from "./engineV3_replay_plate.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";

const PROJECT_FOLDER = "/Users/test/project";
const CAPTURE_NAME = "1793071425958172000_111.json";
const USER_CAPTURE_NAME = "1793071425958000000_111.json";
const SESSION_ID = "session-1";

type ToolCall = { tool_name: string; tool_input: object; tool_use_id: string; tool_response?: string };

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-plate-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function writeCapture(macFolder: string, name: string, sessionId: string, toolCalls: ToolCall[]): void {
    const capturesFolder = join(macFolder, PROJECT_FOLDER, ".plate", "captures");
    mkdirSync(capturesFolder, { recursive: true });
    const capture = { session_id: sessionId, transcript_path: "/t/parent.jsonl", file_changes: { "/a.txt": "a" }, tool_calls: toolCalls };
    writeFileSync(join(capturesFolder, name), JSON.stringify(capture));
}

function makeWriteCall(toolUseId: string, withResponse: boolean): ToolCall {
    const call: ToolCall = { tool_name: "Write", tool_input: { file_path: "/a.txt" }, tool_use_id: toolUseId };
    if (withResponse) {
        call.tool_response = "ok";
    }
    return call;
}

function writeSessionFile(jsonlFolder: string, sessionId: string): void {
    writeFileSync(join(jsonlFolder, `${sessionId}.jsonl`), JSON.stringify({ type: "user", uuid: "u-1" }) + "\n");
}

function writeSubagentFile(jsonlFolder: string, toolUseId: string): string {
    const subagentFolder = join(jsonlFolder, SESSION_ID, "subagents");
    mkdirSync(subagentFolder, { recursive: true });
    const subagentFile = join(subagentFolder, "agent-a1.jsonl");
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: toolUseId, name: "Write", input: {} }] } });
    writeFileSync(subagentFile, line + "\n");
    return subagentFile;
}

test("test_listPlateRuns_lists_one_run_for_an_agent_capture_and_skips_the_user_capture", (t) => {
    // Scenario: a folder holds a "user" capture and an agent capture: only the agent capture is a run.
    const macFolder = makeTempFolder(t);
    writeCapture(macFolder, USER_CAPTURE_NAME, "user", []);
    writeCapture(macFolder, CAPTURE_NAME, SESSION_ID, [makeWriteCall("toolu_1", true)]);
    const jsonlFolder = makeTempFolder(t);
    writeSessionFile(jsonlFolder, SESSION_ID);
    // list the runs
    const runs = listPlateRuns(new Path(macFolder), [new Path(jsonlFolder)]);
    // one run, with the folder that holds .plate as cwd and the file name time in milliseconds
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.cwd.toString(), PROJECT_FOLDER);
    assert.equal(runs[0]?.timeMs, 1793071425958);
    assert.equal(runs[0]?.sessionId.toString(), SESSION_ID);
    assert.equal(runs[0]?.eventName, PlateEventName.PostToolBatch);
});

test("test_listPlateRuns_skips_a_user_capture_without_parsing_its_body", (t) => {
    // Scenario: a user capture can be over 500 MB, so its body is never parsed: a body that is not JSON causes no error.
    const macFolder = makeTempFolder(t);
    const capturesFolder = join(macFolder, PROJECT_FOLDER, ".plate", "captures");
    mkdirSync(capturesFolder, { recursive: true });
    writeFileSync(join(capturesFolder, USER_CAPTURE_NAME), '{"session_id":"user","file_changes":{ this body is not json');
    writeCapture(macFolder, CAPTURE_NAME, SESSION_ID, [makeWriteCall("toolu_1", true)]);
    const jsonlFolder = makeTempFolder(t);
    writeSessionFile(jsonlFolder, SESSION_ID);
    // only the agent capture is a run
    const runs = listPlateRuns(new Path(macFolder), [new Path(jsonlFolder)]);
    assert.equal(runs.length, 1);
});

test("test_getPlateEventName_returns_PostToolBatch_when_every_tool_call_has_a_response", () => {
    assert.equal(getPlateEventName([makeWriteCall("toolu_1", true), makeWriteCall("toolu_2", true)]), PlateEventName.PostToolBatch);
});

test("test_getPlateEventName_returns_SubagentStop_when_no_tool_call_has_a_response", () => {
    assert.equal(getPlateEventName([makeWriteCall("toolu_1", false), makeWriteCall("toolu_2", false)]), PlateEventName.SubagentStop);
});

test("test_getPlateEventName_throws_when_only_some_tool_calls_have_a_response", () => {
    assert.throws(() => getPlateEventName([makeWriteCall("toolu_1", true), makeWriteCall("toolu_2", false)]), /some tool calls/);
});

test("test_listPlateRuns_sets_the_agent_transcript_path_for_a_SubagentStop_run", (t) => {
    // Scenario: the capture has no tool responses, so it is a SubagentStop; the subagent file holds its tool_use_id.
    const macFolder = makeTempFolder(t);
    const jsonlFolder = makeTempFolder(t);
    writeCapture(macFolder, CAPTURE_NAME, SESSION_ID, [makeWriteCall("toolu_9", false)]);
    writeSessionFile(jsonlFolder, SESSION_ID);
    const subagentFile = writeSubagentFile(jsonlFolder, "toolu_9");
    // list the runs
    const runs = listPlateRuns(new Path(macFolder), [new Path(jsonlFolder)]);
    // the run points at the subagent file
    assert.equal(runs[0]?.eventName, PlateEventName.SubagentStop);
    assert.equal(runs[0]?.agentTranscriptPath?.toString(), subagentFile);
});

function makeRepoWithCommitAtTenSeconds(t: TestContext): string {
    const repoFolder = makeTempFolder(t);
    const date = "2026-10-27T00:00:10Z";
    const env = { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];
    execFileSync("git", ["init", "-q"], { cwd: repoFolder, env });
    writeFileSync(join(repoFolder, "a.txt"), "a");
    execFileSync("git", [...gitArgs, "add", "-A"], { cwd: repoFolder, env });
    execFileSync("git", [...gitArgs, "commit", "-q", "-m", "a"], { cwd: repoFolder, env });
    return join(repoFolder, ".git");
}

function makeLineAt(secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 9, 27, 0, 0, secondsPastMidnight)).toISOString();
    return JSON.stringify({ type: "user", uuid: `u-${secondsPastMidnight}`, timestamp, toolUseResult: { note: "x" } });
}

test("test_getNextEvent_places_a_plate_capture_by_time_after_the_line_and_the_outside_git_row", (t) => {
    // Scenario: lines at 5s and 15s, a git row at 10s, a plate capture at 15.5s: the order is line, row, line, capture.
    const gitFolder = makeRepoWithCommitAtTenSeconds(t);
    const jsonlFolder = makeTempFolder(t);
    writeFileSync(join(jsonlFolder, `${SESSION_ID}.jsonl`), [makeLineAt(5), makeLineAt(15)].join("\n") + "\n");
    const macFolder = makeTempFolder(t);
    const captureName = `${BigInt(Date.UTC(2026, 9, 27, 0, 0, 15, 500)) * 1000000n}_1.json`;
    writeCapture(macFolder, captureName, SESSION_ID, [makeWriteCall("toolu_1", true)]);
    // walk the timeline
    const kinds: TimelineEventKind[] = [];
    let lastEvent: TimelineEvent | null = null;
    while (true) {
        const event = getNextEvent(new Path(gitFolder), [new Path(jsonlFolder)], lastEvent, new Path(macFolder));
        if (event === TERMINAL_EVENT) {
            break;
        }
        kinds.push(event.type);
        lastEvent = event;
    }
    assert.deepEqual(kinds, [TimelineEventKind.JSONLLine, TimelineEventKind.OutsideGitAction, TimelineEventKind.JSONLLine, TimelineEventKind.PlateCapture]);
});

test("test_listPlateRuns_throws_when_no_subagent_file_holds_the_tool_use_id", (t) => {
    const macFolder = makeTempFolder(t);
    const jsonlFolder = makeTempFolder(t);
    writeCapture(macFolder, CAPTURE_NAME, SESSION_ID, [makeWriteCall("toolu_9", false)]);
    writeSessionFile(jsonlFolder, SESSION_ID);
    writeSubagentFile(jsonlFolder, "toolu_other");
    assert.throws(() => listPlateRuns(new Path(macFolder), [new Path(jsonlFolder)]), /toolu_9/);
});

test("test_listPlateRuns_ignores_and_prints_a_capture_whose_session_is_not_replayed", (t) => {
    // Scenario: one capture is from the replayed session, one is from a session with no JSONL file.
    const macFolder = makeTempFolder(t);
    const jsonlFolder = makeTempFolder(t);
    writeSessionFile(jsonlFolder, SESSION_ID);
    writeCapture(macFolder, CAPTURE_NAME, SESSION_ID, [makeWriteCall("toolu_1", true)]);
    const strayCaptureName = "1793071425958999000_222.json";
    writeCapture(macFolder, strayCaptureName, "stray-session", [makeWriteCall("toolu_2", true)]);
    const logMock = t.mock.method(console, "log", () => {});
    // list the runs
    const runs = listPlateRuns(new Path(macFolder), [new Path(jsonlFolder)]);
    // only the replayed session has a run
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.sessionId.toString(), SESSION_ID);
    // one line names the ignored session and file
    assert.equal(logMock.mock.callCount(), 1);
    const printedLine = String(logMock.mock.calls[0]?.arguments[0]);
    assert.match(printedLine, /stray-session/);
    assert.match(printedLine, new RegExp(strayCaptureName));
});
