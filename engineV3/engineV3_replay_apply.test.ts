import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { applyCommitToState, applyJSONLLineToState } from "./engineV3_replay_apply.ts";

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
    applyJSONLLineToState(new Path(stateFolder), line!, []);
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
    applyJSONLLineToState(new Path(stateFolder), line!, []);
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
    applyJSONLLineToState(new Path(stateFolder), line!, []);
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
    applyJSONLLineToState(new Path(stateFolder), line!, []);
    // the file exists with the written content
    assert.equal(readFileSync(join(stateFolder, "dir/new.txt"), "utf8"), "created");
});
