import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import type { JSONLLine } from "./engineV3.ts";
import { applyCommitToState, applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";

const NO_SCRIPT_CONTEXT: ScriptReplayContext = { bashCallResults: new Map(), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") };

function runGitWithDate(repoFolder: string, isoDate: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    const env = { ...process.env, GIT_COMMITTER_DATE: isoDate, GIT_AUTHOR_DATE: isoDate };
    return execFileSync("git", gitArgs, { cwd: repoFolder, encoding: "utf8", env }).trim();
}

function commitFileWithDate(repoFolder: string, isoDate: string, name: string, content: string): string {
    const filePath = join(repoFolder, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    runGitWithDate(repoFolder, isoDate, ["add", "-A"]);
    runGitWithDate(repoFolder, isoDate, ["commit", "-q", "-m", name]);
    return runGitWithDate(repoFolder, isoDate, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeWriteCreateLine(stateFolder: string, fileName: string, content: string, secondsPastMidnight: number): string {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
    const toolUseResult = { type: "create", filePath: join(stateFolder, fileName), content, structuredPatch: [], originalFile: null, userModified: false };
    return JSON.stringify({ type: "user", uuid: `u-${fileName}-${secondsPastMidnight}`, timestamp, toolUseResult });
}

function readAppliedEditText(t: TestContext, originalFile: string, hunkLines: string[], oldStart: number): string {
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const filePath = join(stateFolder, "f.txt");
    writeFileSync(filePath, originalFile);
    const structuredPatch = [{ oldStart, oldLines: 1, newStart: oldStart, newLines: 1, lines: hunkLines }];
    const toolUseResult = { filePath, oldString: "part", newString: "other", originalFile, structuredPatch, userModified: false, replaceAll: false };
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 15)).toISOString();
    writeFileSync(join(jsonlFolder, "s1.jsonl"), JSON.stringify({ type: "user", uuid: "u-edit", timestamp, toolUseResult }) + "\n");
    const line = (loadMergedJSONLLines([jsonlFolder]).jsonlLines)[0];
    applyJSONLLineToState(new Path(stateFolder), line!, [], NO_SCRIPT_CONTEXT);
    return readFileSync(filePath, "utf8");
}

test("test_applyJSONLLineToState_drops_the_final_newline_when_a_marker_follows_an_added_line", (t) => {
    // Scenario: old file "A\nX\nY\n", the Edit removes Y and leaves X with no final newline.
    const text = readAppliedEditText(t, "A\nX\nY\n", ["-X", "-Y", "+X", "\\ No newline at end of file"], 2);
    // the new file ends with X and no newline
    assert.equal(text, "A\nX");
});

test("test_applyJSONLLineToState_adds_the_final_newline_when_a_marker_follows_a_removed_line", (t) => {
    // Scenario: old file "A\nX" has no final newline, the Edit adds Z and a final newline.
    const text = readAppliedEditText(t, "A\nX", ["-X", "\\ No newline at end of file", "+X", "+Z"], 2);
    // the new file ends with Z and a newline
    assert.equal(text, "A\nX\nZ\n");
});

function applyEditWithNoOriginalFile(t: TestContext, replayedText: string, hunkLines: string[]): string {
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const filePath = join(stateFolder, "f.txt");
    writeFileSync(filePath, replayedText);
    const structuredPatch = [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: hunkLines }];
    const toolUseResult = { filePath, oldString: "<person>", newString: "<username>", originalFile: null, structuredPatch, userModified: false, replaceAll: false };
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 15)).toISOString();
    writeFileSync(join(jsonlFolder, "s1.jsonl"), JSON.stringify({ type: "user", uuid: "u-edit", timestamp, toolUseResult }) + "\n");
    const line = (loadMergedJSONLLines([jsonlFolder]).jsonlLines)[0];
    applyJSONLLineToState(new Path(stateFolder), line!, [], NO_SCRIPT_CONTEXT);
    return readFileSync(filePath, "utf8");
}

test("test_applyJSONLLineToState_applies_an_Edit_with_no_originalFile_to_the_replayed_file", (t) => {
    // Scenario: the replayed file holds "<person>"; the Edit result has no originalFile and a hunk that writes "<username>".
    const text = applyEditWithNoOriginalFile(t, "A\n<person> rated\nB\n", ["-<person> rated", "+<username> rated"]);
    // the replayed file now holds "<username>"
    assert.equal(text, "A\n<username> rated\nB\n");
});

test("test_applyJSONLLineToState_throws_when_an_Edit_with_no_originalFile_does_not_match_the_replayed_file", (t) => {
    // Scenario: the replayed file does not hold the hunk's old line, so the Edit cannot apply.
    // the replay stops with an error
    assert.throws(() => applyEditWithNoOriginalFile(t, "A\nsomeone rated\nB\n", ["-<person> rated", "+<username> rated"]), /hunk does not match/);
});

const WHOLE_FILE_SNIPPET ="1\t# user was here\n2\tdef greet(name):\n3\t    return \"Hello, \" + name";

function makeUserEditLine(t: TestContext, stateFolder: string, fileName: string, snippet: string = WHOLE_FILE_SNIPPET): JSONLLine {
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const attachment = { type: "edited_text_file", filename: join(stateFolder, fileName), snippet };
    const record = { type: "attachment", uuid: "741f9817-9a3d-4275-936a-3d6b5a9d409e", timestamp: "2026-06-27T16:10:24.962Z", attachment };
    writeFileSync(join(jsonlFolder, "s1.jsonl"), JSON.stringify(record) + "\n");
    return loadMergedJSONLLines([jsonlFolder]).jsonlLines[0]!;
}

const USER_EDIT_CONTENT = "# user was here\ndef greet(name):\n    return \"Hello, \" + name";

test("test_applyJSONLLineToState_user_edit_keeps_the_final_newline_the_old_file_had", (t) => {
    // Scenario: the old file ends with a newline, so the hand-edited file ends with a newline.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    writeFileSync(join(stateFolder, "s.py"), "old text\n");
    applyJSONLLineToState(new Path(stateFolder), makeUserEditLine(t, stateFolder, "s.py"), [], NO_SCRIPT_CONTEXT);
    assert.equal(readFileSync(join(stateFolder, "s.py"), "utf8"), USER_EDIT_CONTENT + "\n");
});

test("test_applyJSONLLineToState_user_edit_keeps_a_missing_final_newline", (t) => {
    // Scenario: the old file has no final newline, so the hand-edited file has none either.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    writeFileSync(join(stateFolder, "s.py"), "old text");
    applyJSONLLineToState(new Path(stateFolder), makeUserEditLine(t, stateFolder, "s.py"), [], NO_SCRIPT_CONTEXT);
    assert.equal(readFileSync(join(stateFolder, "s.py"), "utf8"), USER_EDIT_CONTENT);
});

test("test_applyJSONLLineToState_user_edit_snippet_from_line_1_keeps_the_old_lines_after_its_8_context_lines", (t) => {
    // Scenario: the user adds 2 lines at line 3; the snippet shows lines 1 to 12 and stops before the old last line.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    writeFileSync(join(stateFolder, "s.py"), "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nTAIL\n");
    const snippet = "1\ta\n2\tb\n3\tX\n4\tY\n5\tc\n6\td\n7\te\n8\tf\n9\tg\n10\th\n11\ti\n12\tj";
    applyJSONLLineToState(new Path(stateFolder), makeUserEditLine(t, stateFolder, "s.py", snippet), [], NO_SCRIPT_CONTEXT);
    // the snippet lines come first and the old last line stays after them
    assert.equal(readFileSync(join(stateFolder, "s.py"), "utf8"), "a\nb\nX\nY\nc\nd\ne\nf\ng\nh\ni\nj\nTAIL\n");
});

test("test_applyJSONLLineToState_user_edit_window_starting_mid_file_leaves_the_lines_around_it", (t) => {
    // Scenario: the snippet shows only file lines 3 and 4, so lines 1, 2 and 5 stay as they were.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    writeFileSync(join(stateFolder, "s.py"), "a\nb\nc\nd\ne\n");
    const windowSnippet = "3\tC\n4\tD";
    applyJSONLLineToState(new Path(stateFolder), makeUserEditLine(t, stateFolder, "s.py", windowSnippet), [], NO_SCRIPT_CONTEXT);
    // only lines 3 and 4 changed, the final newline stays
    assert.equal(readFileSync(join(stateFolder, "s.py"), "utf8"), "a\nb\nC\nD\ne\n");
});

test("test_applyJSONLLineToState_user_edit_window_with_a_gap_line_leaves_the_gap_lines", (t) => {
    // Scenario: the snippet shows lines 1 and 4 with "..." between, so lines 2, 3 and 5 stay as they were.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    writeFileSync(join(stateFolder, "s.py"), "a\nb\nc\nd\ne");
    const gapSnippet = "1\tA\n...\n4\tD";
    applyJSONLLineToState(new Path(stateFolder), makeUserEditLine(t, stateFolder, "s.py", gapSnippet), [], NO_SCRIPT_CONTEXT);
    // lines 1 and 4 changed, no final newline is added
    assert.equal(readFileSync(join(stateFolder, "s.py"), "utf8"), "A\nb\nc\nD\ne");
});

test("test_applyJSONLLineToState_user_edit_window_whose_numbers_restart_after_the_gap_patches_the_file_tail", (t) => {
    // Scenario: the file has 7 lines; the snippet shows lines 1-2, then "..." and the file tail numbered 2-3 (the harness numbers the tail by its own older copy).
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    writeFileSync(join(stateFolder, "s.py"), "a\nb\nc\nd\ne\nf\ng\n");
    const restartSnippet = "1\ta\n2\tb\n...\n2\tF\n3\tG";
    applyJSONLLineToState(new Path(stateFolder), makeUserEditLine(t, stateFolder, "s.py", restartSnippet), [], NO_SCRIPT_CONTEXT);
    // the tail lines F and G land on file lines 6 and 7, the lines around them stay
    assert.equal(readFileSync(join(stateFolder, "s.py"), "utf8"), "a\nb\nc\nd\ne\nF\nG\n");
});

test("test_applyJSONLLineToState_user_edit_throws_when_the_file_is_missing_in_the_state", (t) => {
    // Scenario: the state folder has no such file, so the hand edit throws and names the path.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    const line = makeUserEditLine(t, stateFolder, "missing.py");
    assert.throws(() => applyJSONLLineToState(new Path(stateFolder), line, [], NO_SCRIPT_CONTEXT), /missing\.py/);
});

test("test_applyCommitToState_writes_a_nested_file_into_the_state_folder", (t) => {
    // Scenario: a commit adds dir/sub/a.txt, so the state folder gets that file with its content.
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    const commit = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "dir/sub/a.txt", "nested");
    // apply the commit to the empty state folder
    applyCommitToState(new Uuid(commit), new Path(stateFolder), new Path(repoFolder));
    // the nested file exists with the commit's content
    assert.equal(readFileSync(join(stateFolder, "dir/sub/a.txt"), "utf8"), "nested");
});

test("test_applyCommitToState_removes_a_deleted_file_from_the_state_folder", (t) => {
    // Scenario: commit 1 adds gone.txt and commit 2 deletes it, so the state folder loses the file.
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    const addCommit = commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "gone.txt", "soon gone");
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["rm", "-q", "gone.txt"]);
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["commit", "-q", "-m", "delete"]);
    const deleteCommit = runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["rev-parse", "HEAD"]);
    // apply the add commit, then check the file is there
    applyCommitToState(new Uuid(addCommit), new Path(stateFolder), new Path(repoFolder));
    assert.equal(existsSync(join(stateFolder, "gone.txt")), true);
    // apply the delete commit
    applyCommitToState(new Uuid(deleteCommit), new Path(stateFolder), new Path(repoFolder));
    // the file is gone
    assert.equal(existsSync(join(stateFolder, "gone.txt")), false);
});

test("test_applyCommitToState_accepts_a_deleted_file_that_the_state_already_lacks", (t) => {
    // Scenario: a replayed Bash rm already removed gone.txt, then the user's outside commit records that deletion.
    const repoFolder = makeTempFolder(t, "engine-v3-replay-repo-");
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    runGitWithDate(repoFolder, "2026-01-01T00:00:10Z", ["init", "-q"]);
    commitFileWithDate(repoFolder, "2026-01-01T00:00:10Z", "gone.txt", "soon gone");
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["rm", "-q", "gone.txt"]);
    runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["commit", "-q", "-m", "delete"]);
    const deleteCommit = runGitWithDate(repoFolder, "2026-01-01T00:00:20Z", ["rev-parse", "HEAD"]);
    // the state folder does not hold gone.txt
    assert.equal(existsSync(join(stateFolder, "gone.txt")), false);
    // apply the delete commit: it does not throw
    applyCommitToState(new Uuid(deleteCommit), new Path(stateFolder), new Path(repoFolder));
    // the file is still absent
    assert.equal(existsSync(join(stateFolder, "gone.txt")), false);
});

// os.tmpdir() is under /var/folders on macOS, so the /tmp cases need a real folder under /tmp.
function makeTmpRootFolder(t: TestContext): string {
    const folder = mkdtempSync(join("/tmp", "engine-v3-replay-tmproot-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

test("test_applyJSONLLineToState_writes_a_tmp_Write_create_to_the_absolute_tmp_path", (t) => {
    // Scenario: a Write-create line for a file under /tmp writes that /tmp file, not a file in the state folder.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const tmpRootFolder = makeTmpRootFolder(t);
    writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(tmpRootFolder, "scratch/probe.ts", "from tmp", 15) + "\n");
    // load the line the way the engine does
    const line = (loadMergedJSONLLines([jsonlFolder]).jsonlLines)[0];
    // apply the line to the state folder
    applyJSONLLineToState(new Path(stateFolder), line!, [], NO_SCRIPT_CONTEXT);
    // the /tmp file exists with the written content
    assert.equal(readFileSync(join(tmpRootFolder, "scratch/probe.ts"), "utf8"), "from tmp");
    // the state folder stays empty
    assert.equal(readdirSync(stateFolder).length, 0);
});

test("test_applyJSONLLineToState_writes_a_tmp_whole_file_Edit_to_the_absolute_tmp_path", (t) => {
    // Scenario: a whole-file Edit line for a file under /tmp writes the new text to that /tmp file.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    const tmpRootFolder = makeTmpRootFolder(t);
    const filePath = join(tmpRootFolder, "edited.txt");
    const toolUseResult = { filePath, oldString: "old", newString: "new text", originalFile: "old", structuredPatch: [], userModified: false, replaceAll: false };
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 15)).toISOString();
    writeFileSync(join(jsonlFolder, "s1.jsonl"), JSON.stringify({ type: "user", uuid: "u-tmp-edit", timestamp, toolUseResult }) + "\n");
    const line = (loadMergedJSONLLines([jsonlFolder]).jsonlLines)[0];
    // apply the line to the state folder
    applyJSONLLineToState(new Path(stateFolder), line!, [], NO_SCRIPT_CONTEXT);
    // the /tmp file has the new text and the state folder stays empty
    assert.equal(readFileSync(filePath, "utf8"), "new text");
    assert.equal(readdirSync(stateFolder).length, 0);
});

test("test_applyJSONLLineToState_writes_a_Write_create_into_the_state_folder", (t) => {
    // Scenario: a Write-create line for <state>/dir/new.txt writes that file into the state folder.
    const stateFolder = makeTempFolder(t, "engine-v3-replay-state-");
    const jsonlFolder = makeTempFolder(t, "engine-v3-replay-jsonl-");
    writeFileSync(join(jsonlFolder, "s1.jsonl"), makeWriteCreateLine(stateFolder, "dir/new.txt", "created", 15) + "\n");
    // load the line the way the engine does
    const line = (loadMergedJSONLLines([jsonlFolder]).jsonlLines)[0];
    // apply the line to the state folder
    applyJSONLLineToState(new Path(stateFolder), line!, [], NO_SCRIPT_CONTEXT);
    // the file exists with the written content
    assert.equal(readFileSync(join(stateFolder, "dir/new.txt"), "utf8"), "created");
});
