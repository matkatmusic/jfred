import assert from "node:assert/strict";
import { test } from "node:test";
import { readReplaySettingsFromArguments } from "./engineV3_replay_settings.ts";

const REQUIRED_ARGUMENTS = ["--state", "/state", "--touched-out", "/touched.txt", "--mac-plate", "/plate", "--jot", "/jot", "--jsonl", "/jsonl"];

test("test_readReplaySettingsFromArguments_leaves_git_repo_undefined_when_the_flag_is_absent", () => {
  // Step 1: read settings from arguments that have no --git-repo.
  const settings = readReplaySettingsFromArguments(REQUIRED_ARGUMENTS);
  // Step 2: the repo path is undefined and the required flags are still read.
  assert.equal(settings.repoPath, undefined);
  assert.equal(settings.state.toString(), "/state");
  assert.equal(settings.jsonlsPaths[0]?.toString(), "/jsonl");
});

test("test_readReplaySettingsFromArguments_reads_git_repo_when_the_flag_is_given", () => {
  // Step 1: read settings from arguments that have --git-repo.
  const settings = readReplaySettingsFromArguments(["--git-repo", "/repo", ...REQUIRED_ARGUMENTS]);
  // Step 2: the repo path holds the value.
  assert.equal(settings.repoPath?.toString(), "/repo");
});

test("test_readReplaySettingsFromArguments_reads_the_playground_start_files_flag", () => {
  // Step 1: read settings with and without --playground-start-files.
  const withFlag = readReplaySettingsFromArguments(["--playground-start-files", ...REQUIRED_ARGUMENTS]);
  const withoutFlag = readReplaySettingsFromArguments(REQUIRED_ARGUMENTS);
  // Step 2: the setting is true only when the flag is given, and the jsonl path still reads.
  assert.equal(withFlag.writePlaygroundStartFiles, true);
  assert.equal(withoutFlag.writePlaygroundStartFiles, false);
  assert.equal(withFlag.jsonlsPaths[0]?.toString(), "/jsonl");
});

test("test_readReplaySettingsFromArguments_reads_file_history_and_start_files", () => {
  // Step 1: read settings from arguments that have --file-history and --start-files.
  const settings = readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--file-history", "/history", "--start-files", "/start"]);
  // Step 2: both paths hold their values.
  assert.equal(settings.fileHistoryPath?.toString(), "/history");
  assert.equal(settings.startFilesPath?.toString(), "/start");
});

test("test_readReplaySettingsFromArguments_leaves_file_history_and_start_files_undefined_when_absent", () => {
  // Step 1: read settings from arguments that have neither flag.
  const settings = readReplaySettingsFromArguments(REQUIRED_ARGUMENTS);
  // Step 2: both paths are undefined.
  assert.equal(settings.fileHistoryPath, undefined);
  assert.equal(settings.startFilesPath, undefined);
});

test("test_readReplaySettingsFromArguments_reads_snapshots_and_every_watch_folder", () => {
  // Step 1: read settings from arguments that have --snapshots and 2 --watch flags.
  const settings = readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--snapshots", "/snapshots", "--watch", "/watch-one", "--watch", "/watch-two"]);
  // Step 2: the snapshots path and both watch paths hold their values, and the JSONL path is still read.
  assert.equal(settings.snapshotsPath?.toString(), "/snapshots");
  assert.deepEqual(settings.watchPaths.map(String), ["/watch-one", "/watch-two"]);
  assert.equal(settings.jsonlsPaths[0]?.toString(), "/jsonl");
});

test("test_readReplaySettingsFromArguments_leaves_snapshots_undefined_and_watch_empty_when_absent", () => {
  // Step 1: read settings from arguments that have neither flag.
  const settings = readReplaySettingsFromArguments(REQUIRED_ARGUMENTS);
  // Step 2: no snapshots path and no watch paths.
  assert.equal(settings.snapshotsPath, undefined);
  assert.deepEqual(settings.watchPaths, []);
});

test("test_readReplaySettingsFromArguments_splits_stop_before_at_the_last_colon", () => {
  // Step 1: read settings from arguments that have --stop-before with a space in the path.
  const settings = readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--stop-before", "/a b/x.jsonl:70"]);
  // Step 2: the stop-before source holds the path and the line number.
  assert.deepEqual(settings.stopBefore, { filePath: "/a b/x.jsonl", lineNumber: 70 });
});

test("test_readReplaySettingsFromArguments_leaves_stop_before_undefined_when_absent", () => {
  // Step 1: read settings from arguments that have no --stop-before.
  const settings = readReplaySettingsFromArguments(REQUIRED_ARGUMENTS);
  // Step 2: stop-before is undefined.
  assert.equal(settings.stopBefore, undefined);
});

test("test_readReplaySettingsFromArguments_throws_when_the_stop_before_line_is_not_a_number", () => {
  // Step 1: give --stop-before a line part that is not a whole number.
  // Step 2: reading the settings throws and names the bad value.
  assert.throws(() => readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--stop-before", "/a/x.jsonl:abc"]), /\/a\/x\.jsonl:abc/);
});

test("test_readReplaySettingsFromArguments_reads_the_start_at_event_number", () => {
  // Step 1: read settings from arguments that have --start-at and --snapshots.
  const settings = readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--snapshots", "/snapshots", "--start-at", "12"]);
  // Step 2: the start-at setting holds the event number, and the jsonl path is still read.
  assert.equal(settings.startAt, 12);
  assert.equal(settings.jsonlsPaths[0]?.toString(), "/jsonl");
});

test("test_readReplaySettingsFromArguments_leaves_start_at_undefined_without_the_flag", () => {
  // Step 1: read settings from arguments that have no --start-at.
  const settings = readReplaySettingsFromArguments(REQUIRED_ARGUMENTS);
  // Step 2: start-at is undefined.
  assert.equal(settings.startAt, undefined);
});

test("test_readReplaySettingsFromArguments_throws_when_start_at_is_not_a_whole_number", () => {
  // Step 1: give --start-at a value that is not a whole number.
  // Step 2: reading the settings throws and names the bad value.
  assert.throws(() => readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--snapshots", "/snapshots", "--start-at", "1.5"]), /--start-at needs a whole event number of 1 or more, got 1\.5/);
});

test("test_readReplaySettingsFromArguments_throws_when_start_at_is_lower_than_1", () => {
  // Step 1: give --start-at the value 0.
  // Step 2: reading the settings throws and names the bad value.
  assert.throws(() => readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--snapshots", "/snapshots", "--start-at", "0"]), /--start-at needs a whole event number of 1 or more, got 0/);
});

test("test_readReplaySettingsFromArguments_throws_when_start_at_has_no_snapshots_folder", () => {
  // Step 1: give --start-at without --snapshots.
  // Step 2: reading the settings throws and says --snapshots is needed.
  assert.throws(() => readReplaySettingsFromArguments([...REQUIRED_ARGUMENTS, "--start-at", "5"]), /--start-at needs --snapshots <folder>/);
});

test("test_readReplaySettingsFromArguments_still_throws_when_state_is_missing", () => {
  // Step 1: drop --state from the arguments.
  const argumentsWithoutState = REQUIRED_ARGUMENTS.slice(2);
  // Step 2: reading the settings throws the usage text.
  assert.throws(() => readReplaySettingsFromArguments(argumentsWithoutState), /usage: /);
});
