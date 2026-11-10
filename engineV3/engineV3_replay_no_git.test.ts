import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectBashCallResults, type BashCallResult } from "./engineV3_replay_bash_results.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { executeReplay } from "./engineV3_replay.ts";
import { TERMINAL_EVENT, getNextEvent } from "./engineV3_replay_timeline.ts";
import { TimelineEventKind } from "./engineV3.ts";
import { assertHeadMatchesLogInOptionalRepo, copyStartFilesIntoState, createStartState, fillMissingBunLockfileFromOptionalRepo, getGitEnvForOptionalRepo, getRequiredSourceRepo } from "./engineV3_replay_no_git.ts";

const SCENARIO_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios", "executed", "s5-bash-redirect");
const FILE_HISTORY_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios", "file-history");
const SESSION_ID = "1efc63be-c793-4f89-8401-e1c717f3d6e9";
const RECORDED_CWD = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.xbhhfeky";

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function makeS5JsonlFolder(t: TestContext, stateFolder: string): string {
  const jsonlFolder = makeTempFolder(t, "no-git-jsonl-");
  const recordedText = readFileSync(join(SCENARIO_FOLDER, `${SESSION_ID}.jsonl`), "utf8");
  writeFileSync(join(jsonlFolder, `${SESSION_ID}.jsonl`), recordedText.split(RECORDED_CWD).join(stateFolder));
  return jsonlFolder;
}

test("test_copyStartFilesIntoState_copies_nested_files_with_their_relative_paths", (t) => {
  // Step 1: make a start folder with a nested file and an empty state folder.
  const startFolder = makeTempFolder(t, "no-git-start-");
  const stateFolder = makeTempFolder(t, "no-git-state-");
  mkdirSync(join(startFolder, "tests"));
  writeFileSync(join(startFolder, "tests", "conftest.py"), "import sys\n");
  // Step 2: copy the start files into the state folder.
  copyStartFilesIntoState(new Path(startFolder), new Path(stateFolder));
  // Step 3: the nested file sits at the same relative path with the same bytes.
  assert.equal(readFileSync(join(stateFolder, "tests", "conftest.py"), "utf8"), "import sys\n");
});

test("test_copyStartFilesIntoState_does_nothing_when_no_start_folder_is_given", (t) => {
  // Step 1: make an empty state folder.
  const stateFolder = makeTempFolder(t, "no-git-state-");
  // Step 2: copy with no start folder.
  copyStartFilesIntoState(undefined, new Path(stateFolder));
  // Step 3: the state folder stays empty.
  assert.deepEqual(readdirSync(stateFolder), []);
});

test("test_createStartState_without_a_repo_copies_the_start_files_and_makes_no_git_folder", (t) => {
  // Step 1: make a start folder with one file and an empty state folder.
  const startFolder = makeTempFolder(t, "no-git-start-");
  const stateFolder = makeTempFolder(t, "no-git-state-");
  writeFileSync(join(startFolder, "a.txt"), "a\n");
  // Step 2: create the start state with no repo.
  createStartState(undefined, new Path(startFolder), new Path(stateFolder));
  // Step 3: the state holds a.txt and no .git folder.
  assert.deepEqual(readdirSync(stateFolder), ["a.txt"]);
  assert.equal(existsSync(join(stateFolder, ".git")), false);
});

test("test_getRequiredSourceRepo_throws_when_there_is_no_repo", () => {
  // Step 1: ask for the repo when it is undefined.
  // Step 2: the call throws and names the missing flag.
  assert.throws(() => getRequiredSourceRepo(undefined), /--git-repo/);
});

test("test_getRequiredSourceRepo_returns_the_repo_when_it_is_given", () => {
  // Step 1: ask for the repo when it is given.
  const repo = new Path("/repo");
  // Step 2: the same path comes back.
  assert.equal(getRequiredSourceRepo(repo), repo);
});

test("test_git_wrappers_do_nothing_when_there_is_no_repo", (t) => {
  // Step 1: a recorded git call and a spawn output, with no repo.
  const result = { startMs: 0, endMs: 1000, isError: false } as BashCallResult;
  const stateFolder = makeTempFolder(t, "no-git-state-");
  // Step 2: the git env is empty, the HEAD check returns, and the lockfile fill returns.
  assert.deepEqual(getGitEnvForOptionalRepo("git status", result, undefined), {});
  assertHeadMatchesLogInOptionalRepo("git status", result, undefined, new Path(stateFolder), { stdout: "", stderr: "" });
  fillMissingBunLockfileFromOptionalRepo(new Path(stateFolder), { code: "bun install" } as never, undefined);
  // Step 3: the state folder has no .git folder.
  assert.equal(existsSync(join(stateFolder, ".git")), false);
});

test("test_getNextEvent_with_no_repo_returns_only_line_events_then_terminal", (t) => {
  // Step 1: write the s5 JSONL into a temp folder.
  const jsonlFolder = makeS5JsonlFolder(t, "/state");
  // Step 2: walk the timeline with repoPath undefined.
  let lastEvent = null;
  let eventCount = 0;
  while (true) {
    const event = getNextEvent(undefined, [new Path(jsonlFolder)], lastEvent);
    if (event === TERMINAL_EVENT) {
      break;
    }
    // Step 3: every event is a JSONL line event.
    assert.equal(event.type, TimelineEventKind.JSONLLine);
    lastEvent = event;
    eventCount++;
  }
  assert.equal(eventCount, 75);
});

test("test_executeReplay_replays_s5_with_no_git_repo_to_its_last_line", (t) => {
  // Step 1: write the s5 JSONL with the recorded folder replaced by a temp state folder, and copy the start files.
  const stateFolder = makeTempFolder(t, "no-git-state-");
  const jsonlFolder = makeS5JsonlFolder(t, stateFolder);
  const startFolder = makeTempFolder(t, "no-git-start-");
  mkdirSync(join(startFolder, "tests"));
  cpSync(join(SCENARIO_FOLDER, "tests", "conftest.py"), join(startFolder, "tests", "conftest.py"));
  createStartState(undefined, new Path(startFolder), new Path(stateFolder));
  // Step 2: replay every line with no repo and the file-history folder given.
  const lines = loadMergedJSONLLines([jsonlFolder]).jsonlLines;
  const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: new Path(FILE_HISTORY_FOLDER) };
  executeReplay(new Path(stateFolder), undefined, [new Path(jsonlFolder)], [], context);
  // Step 3: the file holds the last recorded content, which also passed the backup checks at lines 42, 55 and 72.
  assert.equal(readFileSync(join(stateFolder, "s5_redirect.txt"), "utf8"), "replaced content\n");
  assert.equal(existsSync(join(stateFolder, "tests", "conftest.py")), true);
});

test("test_executeReplay_throws_on_a_backup_that_differs_from_the_replayed_file", (t) => {
  // Step 1: write the s5 JSONL and a file-history folder whose @v2 backup has other text.
  const stateFolder = makeTempFolder(t, "no-git-state-");
  const jsonlFolder = makeS5JsonlFolder(t, stateFolder);
  const historyFolder = makeTempFolder(t, "no-git-history-");
  cpSync(join(FILE_HISTORY_FOLDER, SESSION_ID), join(historyFolder, SESSION_ID), { recursive: true });
  writeFileSync(join(historyFolder, SESSION_ID, "c80b502247bd4dd9@v2"), "wrong\n");
  const lines = loadMergedJSONLLines([jsonlFolder]).jsonlLines;
  const context = { bashCallResults: collectBashCallResults(lines), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: undefined, fileHistoryPath: new Path(historyFolder) };
  // Step 2: the replay throws at the snapshot line 42 and names the file, the line and both texts.
  assert.throws(() => executeReplay(new Path(stateFolder), undefined, [new Path(jsonlFolder)], [], context), /s5_redirect\.txt[\s\S]*:42[\s\S]*wrong[\s\S]*line one/);
});
