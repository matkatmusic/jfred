import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
// import { MAC_ONLY_FILLS, fillMacOnlyFile, fillMacOnlyFiles, isMacOnlyCommand, isMacOnlyScriptCommand } from "./engineV3_replay_script_skip.ts";
import { MAC_ONLY_FILLS, fillMacOnlyFile, fillMacOnlyFiles, isBrowserTestWithNoProjectWrite, isMacOnlyCommand, readScriptTextFromDisk } from "./engineV3_replay_script_skip.ts";

const CHROME_PROGRAM = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// The first line of the scratchpad shot.ts that 3a0c5929-962b-4bc3-af1f-673d1d5da0b8.jsonl line 417 runs.
const CHROME_SCRIPT_TEXT = `const chrome = "${CHROME_PROGRAM}"\nconst proc = Bun.spawn([chrome, "--headless=new", "--remote-debugging-port=9333", "about:blank"], { stdout: "ignore", stderr: "ignore" })\n`;

test("test_isMacOnlyCommand_is_true_when_the_command_runs_sips", () => {
  // Scenario: sips exists only on the Mac.
  // a command that crops a picture with sips
  const command = "S=/tmp/x; sips --cropOffset 0 0 --cropToHeightWidth 10 10 a.png --out b.png";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_false_when_sips_is_inside_another_word", () => {
  // Scenario: the word rule needs a whole word.
  // a command that reads a file called gossips.txt
  const command = "cat gossips.txt";
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

// The image now has Chromium at the Chrome path, so Chrome calls run for real.
// test("test_isMacOnlyCommand_is_true_when_the_command_starts_the_chrome_program", () => {
//   // Scenario: the Chrome program path in quotes is a Chrome run.
//   // a command that starts headless Chrome
//   const command = `"${CHROME_PROGRAM}" --headless=new --remote-debugging-port=47312`;
//   // the command is Mac only
//   assert.equal(isMacOnlyCommand(command), true);
// });
//
// test("test_isMacOnlyCommand_is_true_when_a_variable_holds_the_chrome_program", () => {
//   // Scenario: a C="..." variable still names the Chrome program.
//   // a command that stores the program path in C and runs it
//   const command = `C="${CHROME_PROGRAM}"; "$C" --headless=new`;
//   // the command is Mac only
//   assert.equal(isMacOnlyCommand(command), true);
// });

// merge: the user chose to skip Mac Chrome calls (typesafe-playground)
// test("test_isMacOnlyCommand_is_false_when_the_command_starts_the_chrome_program", () => {
//   // Scenario: the image has Chromium at the Chrome program path, so a Chrome run is not Mac only.
//   // a command that starts headless Chrome
//   const command = `"${CHROME_PROGRAM}" --headless=new --remote-debugging-port=47312`;
//   // the command is not Mac only
//   assert.equal(isMacOnlyCommand(command), false);
// });

// merge: the user chose to skip Mac Chrome calls (typesafe-playground)
// test("test_isMacOnlyCommand_is_false_when_a_variable_holds_the_chrome_program", () => {
//   // Scenario: a C="..." variable that names the Chrome program does not make the call Mac only.
//   // a command that stores the program path in C and runs it
//   const command = `C="${CHROME_PROGRAM}"; "$C" --headless=new`;
//   // the command is not Mac only
//   assert.equal(isMacOnlyCommand(command), false);
// });

test("test_isMacOnlyCommand_is_true_for_the_recorded_report_png_fill_call", () => {
  // Scenario: the call that MAC_ONLY_FILLS fills (toolu_01MCSxEwsbVK6FgSQZMCN8Jp) runs sips, so it is still skipped and filled.
  // the recorded command of that call
  const command = "S=/private/tmp/claude-501/-Users-matkatmusicllc-Programming-typesafe-playground/2d04358e-e99b-4a40-8519-409322d4bc8c/scratchpad; cp $S/o_1.png /Users/matkatmusicllc/Programming/typesafe-playground/docs/report.png && sips -g pixelWidth -g pixelHeight /Users/matkatmusicllc/Programming/typesafe-playground/docs/report.png";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_false_when_the_command_only_lists_the_chrome_folder", () => {
  // Scenario: a listing of the Chrome folder does not run Chrome.
  // a command that lists the folder
  const command = 'ls "/Applications/Google Chrome.app/Contents/MacOS/" 2>/dev/null';
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

test("test_isMacOnlyCommand_is_true_when_curl_asks_the_skipped_chrome_debugging_port", () => {
  // Scenario: the skipped Mac Chrome listens on port 47312, so a curl to that port finds nothing in the container.
  // a command that asks the debugging port for the Chrome version
  const command = "curl -s http://127.0.0.1:47312/json/version";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_true_when_shot_ts_drives_the_skipped_chrome_debugging_port", () => {
  // Scenario: shot.ts takes the Chrome debugging port as its second argument and saves the picture in the scratchpad.
  // a command that runs shot.ts with server port 47311 and debugging port 47312
  const command = "cd /private/tmp/scratchpad && bun shot.ts 47311 47312 report-new.png";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_false_when_the_command_only_checks_for_the_chrome_process", () => {
  // Scenario: a command that removes a worktree and names the debugging port in a pgrep pattern must still run.
  // a command with a pgrep pattern that names the port
  const command = 'git worktree remove --force /tmp/wt; pgrep -fl "playground.ts --port 47311|remote-debugging-port=47312"';
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

test("test_isMacOnlyCommand_is_false_when_shot_ts_gets_other_ports", () => {
  // Scenario: only the run that names the skipped Chrome's port is skipped.
  // a command that runs shot.ts with other ports
  const command = "cd /tmp/scratchpad && bun shot.ts 47311 40000 report-new.png";
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

test("test_isMacOnlyCommand_is_true_when_curl_asks_the_skipped_chrome_debugging_port_9333", () => {
  // Scenario: the skipped Mac Chrome of session 2fa36f95 listens on port 9333, so a curl to that port finds nothing in the container.
  // a command that asks port 9333 for the Chrome version
  const command = "sleep 3; curl -s http://127.0.0.1:9333/json/version | head -c 150";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_true_when_bun_runs_drive_ts_that_drives_the_skipped_chrome", () => {
  // Scenario: drive.ts opens a WebSocket to the Chrome on port 9333 and prints JSON.
  // a command that runs drive.ts from the scratchpad
  const command = "cd $S && bun drive.ts WITH_FIX 2>&1 | sed '1s/^WITH_FIX //' | jq -c 'del(.initial)'";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_true_when_bun_runs_drive2_ts_that_drives_the_skipped_chrome", () => {
  // Scenario: drive2.ts is the second script that drives the Chrome on port 9333.
  // a command that makes a seed file and runs drive2.ts
  const command = "cd $S; bun makeSeed.ts $S/clone/playground/results/playground-history.json 20; bun drive2.ts 1229 2>&1 | jq -c \"$JQ\"";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_false_when_the_command_only_stops_the_chrome_on_port_9333", () => {
  // Scenario: a command that kills the Chrome by its flag and then runs git status must still run.
  // a command with a pkill pattern that names port 9333
  const command = 'pkill -f "remote-debugging-port=9333"; pgrep -fl "remote-debugging-port=9333" | wc -l; cd /tmp/project && git status --short';
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

// A temp scratchpad folder that holds shot.ts with the given text.
function makeScratchpadWithShotScript(t: TestContext, scriptText: string): string {
  const scratchpad = makeTempFolder(t, "engine-v3-skip-scratchpad-");
  writeFileSync(join(scratchpad, "shot.ts"), scriptText);
  return scratchpad;
}

const PROJECT_FOLDER = "/Users/matkatmusicllc/Programming/Attune";

// The old Chrome script tests below now check the browser test skip rule, which reads script files from disk.
function isBrowserTestSkippedWithDiskScripts(command: string, cwd: Path): boolean {
  return isBrowserTestWithNoProjectWrite(command, cwd, readScriptTextFromDisk, new Map());
}

test("test_isBrowserTestWithNoProjectWrite_skips_the_line_459_call", (t) => {
  // Scenario: 7d070893-e20b-4e1d-a24e-59c9f16d93ff.jsonl line 459 writes multi.ts in the scratchpad, then runs it from the project folder.
  // an empty scratchpad
  const scratchpad = makeTempFolder(t, "engine-v3-skip-scratchpad-");
  // the recorded command shape: a cat heredoc and mkdir after cd into the scratchpad, then bun runs the script with the scratchpad and an id
  const command = `cd ${scratchpad} && cat > multi.ts <<'EOF'\n${CHROME_SCRIPT_TEXT}EOF\nmkdir -p multi-A multi-B; cd ~/Programming/Attune && bun ${scratchpad}/multi.ts ${scratchpad} 06091f42-5d0a-4c0e-9d3b-2a1f0c7e8b11`;
  const heredocFiles = new Map<string, string>();
  // the call is skipped
  assert.equal(isBrowserTestWithNoProjectWrite(command, new Path(PROJECT_FOLDER), readScriptTextFromDisk, heredocFiles), true);
  // the heredoc file is listed with its text
  assert.deepEqual([...heredocFiles], [[join(scratchpad, "multi.ts"), CHROME_SCRIPT_TEXT]]);
});

test("test_isBrowserTestWithNoProjectWrite_skips_a_scratchpad_script_named_through_S", (t) => {
  // Scenario: a later call reruns the scratchpad shot.ts through S and writes only into the scratchpad.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command runs it from the project folder
  const command = `S=${scratchpad}; bun $S/shot.ts $S/c1 "http://localhost:3000/" $S/chat.png`;
  // the call is skipped
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(PROJECT_FOLDER)), true);
});

test("test_isBrowserTestWithNoProjectWrite_skips_a_script_that_a_skipped_call_wrote", () => {
  // Scenario: the script file is not on disk because the call that wrote it was skipped; its recorded text decides.
  // the script text is known only by its path
  const scriptTexts = new Map([["/private/tmp/claude-501/x/scratchpad/shot.ts", CHROME_SCRIPT_TEXT]]);
  // the command runs it
  const command = "S=/private/tmp/claude-501/x/scratchpad; bun $S/shot.ts $S/c1 $S/chat.png";
  // the call is skipped
  assert.equal(isBrowserTestWithNoProjectWrite(command, new Path(PROJECT_FOLDER), (scriptPath) => scriptTexts.get(scriptPath), new Map()), true);
});

test("test_isBrowserTestWithNoProjectWrite_runs_a_chrome_screenshot_into_the_project", () => {
  // Scenario: the screenshot target is inside the project folder.
  // the command starts Chrome with a screenshot into demo/
  const command = `"${CHROME_PROGRAM}" --headless=new --screenshot=$PWD/demo/x.png http://localhost:3000/`;
  // the call runs
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(PROJECT_FOLDER)), false);
});

test("test_isBrowserTestWithNoProjectWrite_runs_a_browser_call_bundled_with_a_python_edit", (t) => {
  // Scenario: a python heredoc edits demo/server.ts before the browser script runs.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command edits the project, then runs the script into the scratchpad
  const command = `S=${scratchpad}; python3 - <<'EOF'\np="demo/server.ts"; s=open(p).read(); open(p,"w").write(s)\nEOF\nbun $S/shot.ts $S/c1 $S/chat.png`;
  // the call runs
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(PROJECT_FOLDER)), false);
});

test("test_isBrowserTestWithNoProjectWrite_runs_a_project_script_that_is_not_a_browser_script", () => {
  // Scenario: demo/makeSession.ts is not a browser script, so the call may write project files.
  // the command runs it from the project folder
  const command = "bun demo/makeSession.ts";
  // the call runs
  assert.equal(isBrowserTestWithNoProjectWrite(command, new Path(PROJECT_FOLDER), () => 'console.log("session")\n', new Map()), false);
});

test("test_isBrowserTestWithNoProjectWrite_runs_a_browser_call_that_also_writes_a_scratchpad_file_with_echo", (t) => {
  // Scenario: a later call may read $S/sid, so a call that writes it with a redirect must run.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command saves an id into the scratchpad, then runs the script
  const command = `S=${scratchpad}; echo a8da816e > $S/sid; bun $S/shot.ts $S/c1 $S/chat.png`;
  // the call runs
  assert.equal(isBrowserTestSkippedWithDiskScripts(command, new Path(PROJECT_FOLDER)), false);
});

test("test_isBrowserTestWithNoProjectWrite_runs_a_browser_script_with_a_relative_output_in_the_project", (t) => {
  // Scenario: the output path is relative and the current folder is the project folder.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command runs it from the project folder with out.png
  const command = `cd ~/Programming/Attune && bun ${scratchpad}/shot.ts out.png`;
  // the call runs
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(scratchpad)), false);
});

test("test_isBrowserTestWithNoProjectWrite_skips_the_line_662_call", () => {
  // Scenario: 7d070893-e20b-4e1d-a24e-59c9f16d93ff.jsonl line 662 screenshots a scratchpad page, then shows it with the Mac open program.
  // the recorded command text
  const command = `S=/private/tmp/claude-501/-Users-matkatmusicllc-Programming-Attune/7d070893-e20b-4e1d-a24e-59c9f16d93ff/scratchpad; "${CHROME_PROGRAM}" --headless=new --disable-gpu --window-size=1300,1100 --screenshot=$S/marks.png file://$S/bubble-marks.html >/dev/null 2>&1; ls -la $S/marks.png; open $S/bubble-marks.html`;
  // the call is skipped
  assert.equal(isBrowserTestSkippedWithDiskScripts(command, new Path(PROJECT_FOLDER)), true);
});

test("test_isMacOnlyScriptCommand_is_true_when_bun_runs_a_script_that_starts_chrome", (t) => {
  // Scenario: the Chrome program path is in the script file, not in the command text.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command runs it with bun
  const command = `bun ${scratchpad}/shot.ts out.png`;
  // the command is Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(scratchpad)), true);
});

test("test_isMacOnlyScriptCommand_is_false_when_bun_runs_a_harmless_script", (t) => {
  // Scenario: a script without a Mac program path runs for real.
  // a scratchpad shot.ts that only prints
  const scratchpad = makeScratchpadWithShotScript(t, 'console.log("hi")\n');
  // the same command runs it with bun
  const command = `bun ${scratchpad}/shot.ts out.png`;
  // the command is not Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(scratchpad)), false);
});

test("test_isMacOnlyScriptCommand_is_false_when_another_part_of_the_command_changes_a_file", (t) => {
  // Scenario: a skip drops the whole call, so a call that also edits a project file must run.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command edits demo/server.ts before it runs the script
  const command = `sd a b demo/server.ts && bun ${scratchpad}/shot.ts out.png`;
  // the command is not Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(scratchpad)), false);
});

test("test_isMacOnlyScriptCommand_is_false_when_the_script_file_does_not_exist", (t) => {
  // Scenario: only a script file that exists in the container can prove a Mac-only run.
  // an empty scratchpad
  const scratchpad = makeTempFolder(t, "engine-v3-skip-scratchpad-");
  // the command runs a missing shot.ts
  const command = `bun ${scratchpad}/shot.ts out.png`;
  // the command is not Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(scratchpad)), false);
});

test("test_isMacOnlyScriptCommand_reads_a_relative_script_path_from_the_cwd", (t) => {
  // Scenario: a script named without a folder is found in the call's cwd.
  // a scratchpad shot.ts that starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the command names shot.ts without a folder, and the cwd is the scratchpad
  const command = "bun shot.ts out.png";
  // the command is Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path(scratchpad)), true);
});

test("test_isMacOnlyScriptCommand_is_true_for_the_line_417_call_with_the_S_variable", (t) => {
  // Scenario: 3a0c5929-962b-4bc3-af1f-673d1d5da0b8.jsonl line 417 sets S and runs $S/shot.ts.
  // a scratchpad shot.ts with the first lines of the recorded script
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the recorded command, with the scratchpad folder in S
  const command = `S=${scratchpad}; pkill -f "remote-debugging-port=9333"; bun $S/shot.ts $S/c1 "http://localhost:3000/?sessionId=a8da816e-4851-4ad7-bf1d-6e99d7555fdf" userA@dummy.email $S/chat.png`;
  // the command is Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path("/Users/matkatmusicllc/Programming/Attune")), true);
});

test("test_isMacOnlyScriptCommand_is_true_for_the_line_447_call_that_also_reads_files", (t) => {
  // Scenario: 3a0c5929-962b-4bc3-af1f-673d1d5da0b8.jsonl line 447 reads demo/index.html with git diff and sed -n, then runs $S/shot.ts.
  // a scratchpad shot.ts with the first lines of the recorded script
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the recorded command, with the scratchpad folder in S
  const command = `S=${scratchpad}; git diff demo/index.html | head -5; sed -n 10,16p demo/index.html; pkill -f "remote-debugging-port=9333"; bun $S/shot.ts $S/c1 "http://localhost:3000/?sessionId=a8da816e-4851-4ad7-bf1d-6e99d7555fdf" userA@dummy.email $S/chat.png`;
  // the command is Mac only
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path("/Users/matkatmusicllc/Programming/Attune")), true);
});

test("test_isMacOnlyScriptCommand_is_false_for_the_line_454_call_that_edits_project_files_first", (t) => {
  // Scenario: 3a0c5929-962b-4bc3-af1f-673d1d5da0b8.jsonl line 454 edits demo/index.html and demo/server.ts with a python heredoc, then runs $S/shot.ts.
  // a scratchpad shot.ts with the first lines of the recorded script
  const scratchpad = makeScratchpadWithShotScript(t, CHROME_SCRIPT_TEXT);
  // the recorded command shape, with the scratchpad folder in S
  const command = `S=${scratchpad}; python3 - <<'EOF'\np="demo/index.html"; s=open(p).read(); open(p,"w").write(s)\nEOF\nrg -n 'templates-here' demo; pkill -f "remote-debugging-port=9333"; bun $S/shot.ts $S/c1 "http://localhost:3000/" userA@dummy.email $S/chat.png`;
  // the command is not Mac only: skipping it would drop the project edits
  assert.equal(isBrowserTestSkippedWithDiskScripts(command,new Path("/Users/matkatmusicllc/Programming/Attune")), false);
});

// A repo whose one commit holds docs/report.png with the given bytes; returns the git folder and the commit.
function makeRepoWithReport(t: TestContext, bytes: Buffer): { gitFolder: Path; commit: string } {
  const repo = makeTempFolder(t, "engine-v3-skip-repo-");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "report.png"), bytes);
  const gitArguments = ["-c", "user.name=T", "-c", "user.email=t@t"];
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", [...gitArguments, "commit", "-q", "-m", "report"], { cwd: repo });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  return { gitFolder: new Path(join(repo, ".git")), commit };
}

test("test_fillMacOnlyFile_writes_the_bytes_of_the_commit_file_into_the_state", (t) => {
  // Scenario: the stand-in file has the same bytes as the file in the source repo commit.
  // the source repo has a commit with docs/report.png
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const source = makeRepoWithReport(t, bytes);
  // the state folder is empty
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // fill the file from that commit
  fillMacOnlyFile(state, { toolUseId: new Uuid("toolu_x"), repoPath: new Path("docs/report.png"), commit: source.commit }, source.gitFolder);
  // the state folder has the same bytes
  assert.deepEqual(readFileSync(join(state.toString(), "docs", "report.png")), bytes);
});

test("test_fillMacOnlyFile_writes_the_bytes_of_the_commit_file_to_the_destination_path", (t) => {
  // Scenario: a skipped screenshot run left a picture in the scratchpad; the fill puts the commit's docs/report.png bytes there.
  // the source repo has a commit with docs/report.png
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0xfe]);
  const source = makeRepoWithReport(t, bytes);
  // the state folder and the scratchpad folder are both empty
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  const scratchpad = makeTempFolder(t, "engine-v3-skip-scratchpad-");
  // fill the scratchpad path from that commit
  const destinationPath = new Path(join(scratchpad, "out", "report.png"));
  fillMacOnlyFile(state, { toolUseId: new Uuid("toolu_x"), repoPath: new Path("docs/report.png"), commit: source.commit, destinationPath }, source.gitFolder);
  // the scratchpad path has the commit's bytes
  assert.deepEqual(readFileSync(destinationPath.toString()), bytes);
  // the state folder has no docs/report.png
  assert.equal(existsSync(join(state.toString(), "docs", "report.png")), false);
});

test("test_fillMacOnlyFiles_writes_nothing_for_a_call_without_a_fill", (t) => {
  // Scenario: only the one named call gets a stand-in file.
  // the state folder is empty and the source repo does not exist
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // fill for another call id
  fillMacOnlyFiles(state, new Uuid("toolu_other"), new Path("/nonexistent"));
  // the state folder has no docs folder
  assert.throws(() => readFileSync(join(state.toString(), "docs", "report.png")), /ENOENT/);
});

// Loads one Bash call line with the given id and command, and builds a context whose recorded result is isError false.
function loadCallAndContext(t: TestContext, command: string, resultText: string, isError: boolean, cwd: string): { line: JSONLLine; context: ScriptReplayContext } {
  const block = { type: "tool_use", id: "toolu_01Skip", name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-skip-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  const result = { toolUseId: new Uuid("toolu_01Skip"), startMs: 0, endMs: 1, isError, resultText, command };
  return { line: loadTranscript(jsonlFile).records[0] as JSONLLine, context: { bashCallResults: new Map([["toolu_01Skip", result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") } };
}

test("test_executeScriptInState_skips_a_call_that_never_ran", (t) => {
  // Scenario: a call blocked by a hook never ran, so the replay does not run it.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call writes ran.txt and its recorded result is a hook error
  const { line, context } = loadCallAndContext(t, "echo ran > ran.txt", "PreToolUse:Bash hook error: no", true, state.toString());
  // run the line
  executeScriptInState(state, line, context);
  // ran.txt is not in the state folder
  assert.equal(existsSync(join(state.toString(), "ran.txt")), false);
});

test("test_executeScriptInState_skips_a_Mac_only_call", (t) => {
  // Scenario: a call that runs sips does not run in the container.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call writes ran.txt after a sips run
  const { line, context } = loadCallAndContext(t, "sips --version; echo ran > ran.txt", "", false, state.toString());
  // run the line
  executeScriptInState(state, line, context);
  // ran.txt is not in the state folder
  assert.equal(existsSync(join(state.toString(), "ran.txt")), false);
});

test("test_executeScriptInState_skips_a_curl_to_the_skipped_chrome_debugging_port", (t) => {
  // Scenario: no Chrome listens in the container, so the recorded curl (exit 7 when run) is not run.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call asks port 47312 for the Chrome version and its recorded result is not an error
  const { line, context } = loadCallAndContext(t, "curl -s http://127.0.0.1:47312/json/version", "{}", false, state.toString());
  // running the line does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line, context));
});

test("test_executeScriptInState_skips_a_shot_ts_run_that_drives_the_skipped_chrome", (t) => {
  // Scenario: shot.ts would drive the skipped Chrome; here the scratchpad has no shot.ts, so a run would fail.
  // the state folder is the record's cwd and holds no shot.ts
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call runs shot.ts against port 47312 and its recorded result is not an error
  const { line, context } = loadCallAndContext(t, `cd ${state.toString()} && bun shot.ts 47311 47312 report-new.png`, "[]", false, state.toString());
  // running the line does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line, context));
});

test("test_executeScriptInState_skips_a_curl_to_the_skipped_chrome_debugging_port_9333", (t) => {
  // Scenario: no Chrome listens in the container, so the recorded curl is not run.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call asks port 9333 for the Chrome version and its recorded result is not an error
  const { line, context } = loadCallAndContext(t, "curl -s http://127.0.0.1:9333/json/version", "{}", false, state.toString());
  // running the line does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line, context));
});

test("test_executeScriptInState_skips_a_drive_ts_run_that_drives_the_skipped_chrome", (t) => {
  // Scenario: drive.ts would drive the skipped Chrome; here the scratchpad has no drive.ts, so a run would exit 1.
  // the state folder is the record's cwd and holds no drive.ts
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call runs drive.ts and its recorded result is not an error
  const { line, context } = loadCallAndContext(t, `cd ${state.toString()} && bun drive.ts WITH_FIX`, "[]", false, state.toString());
  // running the line does not throw
  assert.doesNotThrow(() => executeScriptInState(state, line, context));
});

test("test_MAC_ONLY_FILLS_puts_the_a458d15_report_png_into_report_new_png_for_the_last_two_shot_ts_runs", () => {
  // Scenario: the cp at line 263 and the cp at line 303 of agent-ac894917bac015fa9.jsonl copy report-new.png into docs/report.png; commit a458d15 holds the final picture.
  const scratchpadPicture = "/private/tmp/claude-501/-Users-matkatmusicllc-Programming-typesafe-playground/24366073-dc22-42eb-a4fe-73006a20752f/scratchpad/report-new.png";
  // the last shot.ts run before line 263 (line 242) and the last before line 303 (line 292)
  for (const toolUseId of ["toolu_01Q4iavqiTRdi2JyrbBbDqAK", "toolu_01RdrCxapAehwcJuUvnpQhct"]) {
    // the call has one fill
    const fills = MAC_ONLY_FILLS.filter((candidate) => candidate.toolUseId.toString() === toolUseId);
    assert.equal(fills.length, 1);
    // the fill writes docs/report.png from commit a458d15 to report-new.png in the scratchpad
    const fill = fills[0]!;
    assert.equal(fill.repoPath.toString(), "docs/report.png");
    assert.equal(fill.commit, "a458d15");
    assert.equal(fill.destinationPath?.toString(), scratchpadPicture);
  }
});

// The image now has Chromium at the Chrome path, so a call that runs a Chrome script file runs for real.
// test("test_executeScriptInState_skips_a_call_that_runs_a_Mac_only_script_and_leaves_the_state_unchanged", (t) => {
//   // Scenario: a call that runs a Chrome script file does not run in the container.
//   // the state folder is the record's cwd and is empty
//   const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
//   // the script fails if it runs, but the recorded result is not an error
//   const scratchpad = makeScratchpadWithShotScript(t, `${CHROME_SCRIPT_TEXT}process.exit(3)\n`);
//   const command = `S=${scratchpad}; pkill -f "remote-debugging-port=9333"; bun $S/shot.ts $S/c1 $S/chat.png`;
//   const { line, context } = loadCallAndContext(t, command, "", false, state.toString());
//   // run the line: it does not throw
//   executeScriptInState(state, line, context);
//   // the state folder is still empty
//   assert.deepEqual(readdirSync(state.toString()), []);
// });

test("test_executeScriptInState_runs_a_call_that_runs_a_Chrome_script", (t) => {
  // Scenario: a Chrome script call with a part the skip rule cannot read (python3) runs for real.
  // the state folder is the record's cwd and is empty
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the script names the Chrome program, writes ran.txt into the cwd and exits before it starts Chrome
  const scratchpad = makeScratchpadWithShotScript(t, `const chrome = "${CHROME_PROGRAM}"\nawait Bun.write("ran.txt", chrome)\n`);
  // const command = `S=${scratchpad}; bun $S/shot.ts $S/c1 $S/chat.png`;
  const command = `S=${scratchpad}; python3 -c 'pass'; bun $S/shot.ts $S/c1 $S/chat.png`;
  const { line, context } = loadCallAndContext(t, command, "", false, state.toString());
  // run the line
  executeScriptInState(state, line, context);
  // the script ran: ran.txt is in the state folder
  assert.equal(readFileSync(join(state.toString(), "ran.txt"), "utf8"), CHROME_PROGRAM);
});

// merge: the user chose to skip Mac Chrome calls (typesafe-playground)
// test("test_executeScriptInState_skips_a_browser_test_and_writes_its_heredoc_script", (t) => {
//   // Scenario: the line 459 shape is skipped, and multi.ts is still written so later calls can run it.
//   // the state folder is the record's cwd and is empty; the scratchpad is empty
//   const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
//   const scratchpad = makeTempFolder(t, "engine-v3-skip-scratchpad-");
//   // the script would write ran.txt into the cwd if it ran
//   const scriptText = `const chrome = "${CHROME_PROGRAM}"\nawait Bun.write("ran.txt", chrome)\n`;
//   const command = `cd ${scratchpad} && cat > multi.ts <<'EOF'\n${scriptText}EOF\nmkdir -p multi-A; cd ${state.toString()} && bun ${scratchpad}/multi.ts ${scratchpad}`;
//   const { line, context } = loadCallAndContext(t, command, "", false, state.toString());
//   // run the line
//   executeScriptInState(state, line, context);
//   // the call did not run: the state folder is still empty
//   assert.deepEqual(readdirSync(state.toString()), []);
//   // the heredoc script is in the scratchpad with its recorded text
//   assert.equal(readFileSync(join(scratchpad, "multi.ts"), "utf8"), scriptText);
// });

test("test_executeScriptInState_skips_a_read_only_internet_call_and_leaves_the_state_unchanged", (t) => {
  // Scenario: a call that needs the internet and changes no file does not run in the container.
  // the state folder is the record's cwd and is empty
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call fails if it runs, but its recorded result is not an error
  const { line, context } = loadCallAndContext(t, "dig +short example.com; cat no-such-file-engine-v3", "", false, state.toString());
  // run the line: it does not throw
  executeScriptInState(state, line, context);
  // the state folder is still empty
  assert.deepEqual(readdirSync(state.toString()), []);
});

test("test_executeScriptInState_skips_a_read_only_Mac_state_call_and_leaves_the_state_unchanged", (t) => {
  // Scenario: user decision 9: a call that only looks at Mac programs and changes no file does not run in the container.
  // the state folder is the record's cwd and is empty
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call fails if it runs, because no claude program runs in the container, but its recorded result is not an error
  const { line, context } = loadCallAndContext(t, "pgrep -x claude-engine-v3-none | rg harms", "", false, state.toString());
  // run the line: it does not throw
  executeScriptInState(state, line, context);
  // the state folder is still empty
  assert.deepEqual(readdirSync(state.toString()), []);
});

test("test_MAC_ONLY_FILLS_names_the_report_png_call_and_its_commit", () => {
  // Scenario: the one skipped call that copied docs/report.png gets that file back from commit 9becb03.
  // the fill list has one entry for that call
  const fills = MAC_ONLY_FILLS.filter((candidate) => candidate.toolUseId.toString() === "toolu_01MCSxEwsbVK6FgSQZMCN8Jp");
  assert.equal(fills.length, 1);
  // the entry names the call, the repo path and the commit
  const fill = fills[0]!;
  assert.equal(fill.toolUseId.toString(), "toolu_01MCSxEwsbVK6FgSQZMCN8Jp");
  assert.equal(fill.repoPath.toString(), "docs/report.png");
  assert.equal(fill.commit, "9becb03");
});
