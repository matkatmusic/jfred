import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Path, Uuid } from "../src/structures/domain.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { executeReplay, formatEventText } from "./engineV3_replay.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { createStartState } from "./engineV3_replay_no_git.ts";
import { PlateEventName } from "./engineV3_replay_plate.ts";
import { getNextEvent } from "./engineV3_replay_timeline.ts";

type TimedRepo = { repoFolder: string; commitA: string };

function runGitWithDate(repoFolder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: repoFolder, encoding: "utf8", env }).trim();
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// One commit A at 10s.
function makeTimedRepo(t: TestContext): TimedRepo {
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["init", "-q"]);
    writeFileSync(join(repoFolder, "change.txt"), "old");
    runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["add", "-A"]);
    runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["commit", "-q", "-m", "change.txt"]);
    const commitA = runGitWithDate(repoFolder, "2026-10-27T00:00:10Z", ["rev-parse", "HEAD"]);
    return { repoFolder, commitA };
}

function makeWriteCreateLine(repoFolder: string, fileName: string, content: string, secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 9, 27, 0, 0, secondsPastMidnight)).toISOString();
    const toolUseResult = { type: "create", filePath: join(repoFolder, fileName), content, structuredPatch: [], originalFile: null, userModified: false };
    return JSON.stringify({ type: "user", uuid: `u-${fileName}-${secondsPastMidnight}`, timestamp, toolUseResult });
}

// Commit events are turned off: the old commit-event test is kept here, commented out.
// test("test_formatEventText_names_the_repo_and_full_hash_for_a_commit", (t) => {
//     const timedRepo = makeTimedRepo(t);
//     const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
//     writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15) + "\n");
//     const repoPath = new Path(join(timedRepo.repoFolder, ".git"));
//     const event = getNextEvent(repoPath, [new Path(jsonlFolder)], null) as TimelineEvent;
//     assert.equal(formatEventText(event, repoPath), `next event: source:${join(timedRepo.repoFolder, ".git")} commit:${timedRepo.commitA}`);
// });

const FIXED_NOW_MS = 1794267667512;
const FIXED_NOW_ISO = "2026-11-09T23:41:07.512Z";

test("test_formatEventText_names_the_kind_new_commit_and_message_for_an_outside_git_row", (t) => {
    // Scenario: the first event is the outside row of commit A, so the text names its kind, new commit and message.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15) + "\n");
    const repoPath = new Path(join(timedRepo.repoFolder, ".git"));
    const event = getNextEvent(repoPath, [new Path(jsonlFolder)], null) as TimelineEvent;
    // format the outside git event with the clock fixed
    t.mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS });
    assert.equal(formatEventText(event, repoPath), `${FIXED_NOW_ISO} next event: outside git: Commit ${timedRepo.commitA} commit (initial): change.txt`);
});

test("test_formatEventText_names_the_jsonl_file_and_line_number_for_a_line", (t) => {
    // Scenario: the second event is the line at 15s, so the text names its file and line number.
    const timedRepo = makeTimedRepo(t);
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(timedRepo.repoFolder, "x.txt", "x", 15) + "\n");
    const repoPath = new Path(join(timedRepo.repoFolder, ".git"));
    const jsonlsPaths = [new Path(jsonlFolder)];
    // step past the row of commit A to the line
    const commitEvent = getNextEvent(repoPath, jsonlsPaths, null) as TimelineEvent;
    const lineEvent = getNextEvent(repoPath, jsonlsPaths, commitEvent) as TimelineEvent;
    // format the line event with the clock fixed
    t.mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS });
    assert.equal(formatEventText(lineEvent, repoPath), `${FIXED_NOW_ISO} next event: source:${join(jsonlFolder, "s1.jsonl")} line:1`);
});

test("test_formatEventText_prints_the_capture_file_name_event_name_and_cwd_of_a_plate_capture", (t) => {
    const capture = { captureFile: new Path("/m/.plate/captures/1_2.json"), eventName: PlateEventName.SubagentStop, cwd: new Path("/m/proj"), sessionId: new Uuid("s"), transcriptPath: new Path("/t.jsonl"), toolCalls: [], agentTranscriptPath: undefined, timeMs: 0 };
    const event: TimelineEvent = { type: TimelineEventKind.PlateCapture, capture, timestamp: 0 };
    t.mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS });
    assert.equal(formatEventText(event, new Path("/r")), `${FIXED_NOW_ISO} next event: plate capture: 1_2.json SubagentStop /m/proj`);
});

const S5_SCENARIO_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios", "executed", "s5-bash-redirect");
const S5_FILE_HISTORY_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios", "file-history");
const S5_SESSION_ID = "1efc63be-c793-4f89-8401-e1c717f3d6e9";
const S5_RECORDED_CWD = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.xbhhfeky";
// Line 33 is the Write call that creates s5_redirect.txt
const S5_WRITE_LINE_NUMBER = 33;

function makeRealTempFolder(t: TestContext, prefix: string): string {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

test("test_executeReplay_stops_before_the_given_line_and_writes_that_line_to_the_next_line_file", (t) => {
    // Scenario: replaying s5 with a stop before line 33 leaves the earlier file in place, never runs line 33, and saves line 33.
    // write the s5 JSONL into a temp folder, and make the state with the conftest.py start file (the "a" file)
    const stateFolder = makeRealTempFolder(t, "stop-before-state-");
    const jsonlFolder = makeRealTempFolder(t, "stop-before-jsonl-");
    const jsonlFile = join(jsonlFolder, `${S5_SESSION_ID}.jsonl`);
    const jsonlText = readFileSync(join(S5_SCENARIO_FOLDER, `${S5_SESSION_ID}.jsonl`), "utf8").split(S5_RECORDED_CWD).join(stateFolder);
    writeFileSync(jsonlFile, jsonlText);
    const startFolder = makeRealTempFolder(t, "stop-before-start-");
    mkdirSync(join(startFolder, "tests"));
    cpSync(join(S5_SCENARIO_FOLDER, "tests", "conftest.py"), join(startFolder, "tests", "conftest.py"));
    createStartState(undefined, new Path(startFolder), new Path(stateFolder));
    const nextLineFile = join(makeRealTempFolder(t, "stop-before-out-"), "next-line.json");
    // replay with a stop before line 33, the Write that creates s5_redirect.txt (the "b" file)
    const lines = loadMergedJSONLLines([jsonlFolder]).jsonlLines;
    const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: new Path(S5_FILE_HISTORY_FOLDER) };
    const stopBefore = { line: { filePath: jsonlFile, lineNumber: S5_WRITE_LINE_NUMBER }, nextLineFile: new Path(nextLineFile) };
    // the replay throws, the "a" file exists, and the "b" file does not
    assert.throws(() => executeReplay(new Path(stateFolder), undefined, [new Path(jsonlFolder)], [], context, undefined, stopBefore), /stopped before/);
    assert.equal(existsSync(join(stateFolder, "tests", "conftest.py")), true);
    assert.equal(existsSync(join(stateFolder, "s5_redirect.txt")), false);
    // the next line file holds line 33 (1-based) of the JSONL, which is the Write of s5_redirect.txt
    const rawLine = jsonlText.split("\n")[S5_WRITE_LINE_NUMBER - 1]!;
    assert.match(rawLine, /s5_redirect\.txt/);
    assert.deepEqual(JSON.parse(readFileSync(nextLineFile, "utf8")), JSON.parse(rawLine));
});
