import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { PlateEventName, type PlateRun } from "./engineV3_replay_plate.ts";
import { assertPlateCapturesEqual, executePlateHook, executePlateRun } from "./engineV3_replay_plate_run.ts";
import { clearSeenBackups, recordContinuedFailure, recordProvenBytes } from "./engineV3_replay_backups.ts";

const REAL_JOT_FOLDER = join(homedir(), "Programming", "jot");
const JOT_HOOK_FILES = ["common/scripts/plate/plate_capture_hook.py", "common/scripts/git_lib.py", "external/claude_plugin_lib/git_lib.py", "external/claude_plugin_lib/util_lib.py"];
const MAC_CAPTURE_NAME = "1793071425958172000_111.json";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-plate-run-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function copyJotFiles(t: TestContext): Path {
    const jotFolder = makeTempFolder(t);
    for (const relativeFile of JOT_HOOK_FILES) {
        mkdirSync(dirname(join(jotFolder, relativeFile)), { recursive: true });
        copyFileSync(join(REAL_JOT_FOLDER, relativeFile), join(jotFolder, relativeFile));
    }
    return new Path(jotFolder);
}

// A repo whose HEAD holds a.txt = "old" and whose disk holds a.txt = "new", as after an agent Write.
function makeRepoWithAgentWrite(t: TestContext): string {
    const repoFolder = makeTempFolder(t);
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];
    execFileSync("git", ["init", "-q"], { cwd: repoFolder });
    writeFileSync(join(repoFolder, "a.txt"), "old\n");
    execFileSync("git", [...gitArgs, "add", "-A"], { cwd: repoFolder });
    execFileSync("git", [...gitArgs, "commit", "-q", "-m", "first"], { cwd: repoFolder });
    writeFileSync(join(repoFolder, "a.txt"), "new\n");
    return repoFolder;
}

function makeRun(repoFolder: string, captureFile: string): PlateRun {
    const toolCall = { tool_name: "Write", tool_input: { file_path: join(repoFolder, "a.txt"), content: "new\n" }, tool_use_id: "toolu_1", tool_response: "ok" };
    return { captureFile: new Path(captureFile), eventName: PlateEventName.PostToolBatch, cwd: new Path(repoFolder), sessionId: new Uuid("session-1"), transcriptPath: new Path("/t/parent.jsonl"), toolCalls: [toolCall], agentTranscriptPath: undefined, timeMs: 1793071425958 };
}

function writeCaptureFile(folder: string, name: string, fileChanges: Record<string, string | null>): string {
    const captureFile = join(folder, name);
    writeFileSync(captureFile, JSON.stringify({ session_id: "session-1", transcript_path: "/t/parent.jsonl", file_changes: fileChanges, tool_calls: [] }));
    return captureFile;
}

test("test_executePlateHook_writes_one_agent_capture_with_the_disk_text", (t) => {
    // Scenario: the real hook runs in a repo whose disk text differs from HEAD; it writes one agent capture.
    const repoFolder = makeRepoWithAgentWrite(t);
    const run = makeRun(repoFolder, "/unused/capture.json");
    // run the hook
    const replayCapture = executePlateHook(run, copyJotFiles(t));
    // the new capture holds a.txt with the disk text
    const capture = JSON.parse(readFileSync(replayCapture.toString(), "utf8"));
    assert.deepEqual(capture.file_changes, { [join(repoFolder, "a.txt")]: "new\n" });
    // the hook put .plate/ into .gitignore
    assert.match(readFileSync(join(repoFolder, ".gitignore"), "utf8"), /^\.plate\/$/m);
    assert.equal(readdirSync(join(repoFolder, ".plate", "captures")).includes(replayCapture.toString().split("/").pop() as string), true);
});

function createAssistantWriteLine(filePath: string, timestamp: string): string {
    const block = { type: "tool_use", id: "toolu_" + timestamp.slice(-5, -1), name: "Write", input: { file_path: filePath, content: "new\n" } };
    return JSON.stringify({ type: "assistant", timestamp, message: { content: [block] } });
}

test("test_executePlateHook_for_SubagentStop_ignores_agent_lines_later_than_the_capture_time", (t) => {
    // Scenario: the agent file holds a Write before and a Write after the capture time; the capture holds only the first file.
    const repoFolder = makeRepoWithAgentWrite(t);
    writeFileSync(join(repoFolder, "b.txt"), "new\n");
    const transcriptFile = join(makeTempFolder(t), "agent-x.jsonl");
    const lines = [createAssistantWriteLine(join(repoFolder, "a.txt"), "2026-10-27T03:23:45.000Z"), createAssistantWriteLine(join(repoFolder, "b.txt"), "2026-10-27T03:34:03.000Z")];
    writeFileSync(transcriptFile, lines.join("\n") + "\n");
    const run: PlateRun = { ...makeRun(repoFolder, join("/unused", MAC_CAPTURE_NAME)), eventName: PlateEventName.SubagentStop, toolCalls: [], agentTranscriptPath: new Path(transcriptFile) };
    // run the hook
    const replayCapture = executePlateHook(run, copyJotFiles(t));
    // only a.txt is in the capture
    const capture = JSON.parse(readFileSync(replayCapture.toString(), "utf8"));
    assert.deepEqual(Object.keys(capture.file_changes), [join(repoFolder, "a.txt")]);
});

test("test_executePlateRun_passes_when_the_replay_capture_equals_the_mac_capture", (t) => {
    const repoFolder = makeRepoWithAgentWrite(t);
    const macFolder = makeTempFolder(t);
    const macCapture = writeCaptureFile(macFolder, MAC_CAPTURE_NAME, { [join(repoFolder, "a.txt")]: "new\n" });
    executePlateRun(makeRun(repoFolder, macCapture), copyJotFiles(t));
    assert.equal(existsSync(join(repoFolder, ".plate", "captures")), true);
});

test("test_assertPlateCapturesEqual_throws_with_path_file_name_time_and_diff_for_a_differing_file", (t) => {
    const folder = makeTempFolder(t);
    const macCapture = writeCaptureFile(folder, MAC_CAPTURE_NAME, { "/r/a.txt": "one\ntwo\nthree\n" });
    const replayCapture = writeCaptureFile(folder, "2_2.json", { "/r/a.txt": "one\nTWO\nthree\n" });
    assert.throws(() => assertPlateCapturesEqual(new Path(macCapture), new Path(replayCapture)), checkDifferingFileError);
});

function checkDifferingFileError(error: Error): boolean {
    assert.match(error.message, /\/r\/a\.txt/);
    assert.match(error.message, new RegExp(MAC_CAPTURE_NAME));
    assert.match(error.message, /2026-10-27T03:23:45\.958Z/);
    assert.match(error.message, /line 2: mac="two" replay="TWO"/);
    return true;
}

test("test_assertPlateCapturesEqual_throws_when_a_path_is_missing_in_the_replay_capture", (t) => {
    const folder = makeTempFolder(t);
    const macCapture = writeCaptureFile(folder, MAC_CAPTURE_NAME, { "/r/a.txt": "a", "/r/b.txt": "b" });
    const replayCapture = writeCaptureFile(folder, "2_2.json", { "/r/a.txt": "a" });
    assert.throws(() => assertPlateCapturesEqual(new Path(macCapture), new Path(replayCapture)), /\/r\/b\.txt.*missing in the replay capture/);
});

test("test_assertPlateCapturesEqual_throws_when_a_path_is_missing_in_the_mac_capture", (t) => {
    const folder = makeTempFolder(t);
    const macCapture = writeCaptureFile(folder, MAC_CAPTURE_NAME, { "/r/a.txt": "a" });
    const replayCapture = writeCaptureFile(folder, "2_2.json", { "/r/a.txt": "a", "/r/c.txt": "c" });
    assert.throws(() => assertPlateCapturesEqual(new Path(macCapture), new Path(replayCapture)), /\/r\/c\.txt.*missing in the Mac capture/);
});

type CaptureMismatch = { replayedFile: string; macCapture: Path; replayCapture: Path };

// The replayed file on disk and the replay capture hold replayedText; the Mac capture holds macText.
function makeCaptureMismatch(t: TestContext, replayedText: string, macText: string): CaptureMismatch {
    clearSeenBackups();
    const folder = makeTempFolder(t);
    const replayedFile = join(folder, "a.txt");
    writeFileSync(replayedFile, replayedText);
    const macCapture = writeCaptureFile(folder, MAC_CAPTURE_NAME, { [replayedFile]: macText });
    const replayCapture = writeCaptureFile(folder, "2_2.json", { [replayedFile]: replayedText });
    return { replayedFile, macCapture: new Path(macCapture), replayCapture: new Path(replayCapture) };
}

test("test_assertPlateCapturesEqual_throws_when_the_replay_blanked_a_file_with_a_proven_text", (t) => {
    // Scenario (the 267 shape): a Write gave the file its full text, then the replay blanked it; the Mac capture has the full text.
    const mismatch = makeCaptureMismatch(t, "", "one\ntwo\n");
    recordProvenBytes(mismatch.replayedFile, Buffer.from("one\ntwo\n"));
    // the check throws as before, and the file keeps its replayed bytes
    assert.throws(() => assertPlateCapturesEqual(mismatch.macCapture, mismatch.replayCapture), /a\.txt differs/);
    assert.equal(readFileSync(mismatch.replayedFile, "utf8"), "");
});

test("test_assertPlateCapturesEqual_throws_when_a_script_changed_the_file_after_its_proven_text", (t) => {
    // Scenario (the 311 shape): a Write gave the file its full text, then a Bash call wrote other bytes than the record says.
    const mismatch = makeCaptureMismatch(t, "one\nscript bytes\n", "one\nrecord bytes\n");
    recordProvenBytes(mismatch.replayedFile, Buffer.from("one\ntwo\n"));
    // the check throws, and the file keeps the script's bytes
    assert.throws(() => assertPlateCapturesEqual(mismatch.macCapture, mismatch.replayCapture), /a\.txt differs/);
    assert.equal(readFileSync(mismatch.replayedFile, "utf8"), "one\nscript bytes\n");
});

test("test_assertPlateCapturesEqual_throws_for_a_file_with_no_proven_text", (t) => {
    // Scenario: no Write, Edit with originalFile, capture or backup ever gave this file a full text.
    const mismatch = makeCaptureMismatch(t, "one\n", "one\nhand\n");
    // the check throws, and the file keeps its bytes
    assert.throws(() => assertPlateCapturesEqual(mismatch.macCapture, mismatch.replayCapture), /a\.txt differs/);
    assert.equal(readFileSync(mismatch.replayedFile, "utf8"), "one\n");
});

test("test_assertPlateCapturesEqual_throws_instead_of_copying_after_a_failed_call_went_on", (t) => {
    // Scenario: the file still has its proven text, but a failed call that went on may have changed it on the Mac.
    const mismatch = makeCaptureMismatch(t, "one\n", "one\nhand\n");
    recordProvenBytes(mismatch.replayedFile, Buffer.from("one\n"));
    recordContinuedFailure("s.jsonl:9");
    // the check throws and names the failed call; the file keeps its bytes
    assert.throws(() => assertPlateCapturesEqual(mismatch.macCapture, mismatch.replayCapture), /after the failed call s\.jsonl:9 went on/);
    assert.equal(readFileSync(mismatch.replayedFile, "utf8"), "one\n");
});

test("test_executePlateRun_copies_a_hand_edit_seen_only_in_the_plate_capture", (t) => {
    // Scenario (the 633 shape): a Write gave a.txt its full text, nothing else changed it, and the Mac capture differs in one line.
    clearSeenBackups();
    const repoFolder = makeRepoWithAgentWrite(t);
    const replayedFile = join(repoFolder, "a.txt");
    recordProvenBytes(replayedFile, Buffer.from("new\n"));
    const macFolder = makeTempFolder(t);
    const firstMacCapture = writeCaptureFile(macFolder, MAC_CAPTURE_NAME, { [replayedFile]: "new by hand\n" });
    const logged: string[] = [];
    t.mock.method(console, "log", (text: string) => logged.push(text));
    const jotFolder = copyJotFiles(t);
    // the run copies the capture text into the state and logs one note
    executePlateRun(makeRun(repoFolder, firstMacCapture), jotFolder);
    assert.equal(readFileSync(replayedFile, "utf8"), "new by hand\n");
    assert.equal(logged.length, 1);
    assert.match(logged[0] as string, new RegExp(`note: hand edit copied from plate capture: ${replayedFile} ${MAC_CAPTURE_NAME} 1 changed lines, first at line 1$`));
    // a following identical capture passes with no second copy
    const secondMacCapture = writeCaptureFile(macFolder, "1793071425959172000_111.json", { [replayedFile]: "new by hand\n" });
    executePlateRun(makeRun(repoFolder, secondMacCapture), jotFolder);
    assert.equal(logged.length, 1);
});
