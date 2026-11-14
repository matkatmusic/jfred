import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAttachmentEntry, type AttachmentEntry } from "../src/structures/session-meta.ts";
import { loadJSONLLineIndex } from "./engineV3_jsonl_line_index.ts";
import { collectPostToolHookRewrites, listStopHookReformattedFiles, runRecordedPostToolHook, runRecordedStopHookReformat } from "./engineV3_replay_post_tool_hooks.ts";

const REFLOW_COMMENTS_STATUS_MESSAGE = "Reflowing wrapped comments...";
const FIRST_ATTUNE_REWRITE_TIME = "2026-10-06T15:15:40.402Z";
const ONE_LINE_COMMENT_TEXT = "<body>\n<!-- templates -->\n<div></div>\n</body>\n";
const REFLOWED_COMMENT_TEXT = "<body>\n<!--\n  templates\n-->\n<div></div>\n</body>\n";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-post-tool-hooks-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeRewriteStdout(file: string, lines: number[]): string {
    const additionalContext = JSON.stringify({ information: "the following lines were rewritten by a hook after your edit", rewritten: [{ file, lines }] });
    return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } })}\n`;
}

function makeHookSuccessLine(toolUseId: string, command: string, stdout: string): string {
    const attachment = { type: "hook_success", hookName: "PostToolUse:Edit", toolUseID: toolUseId, hookEvent: "PostToolUse", content: "", stdout, stderr: "", exitCode: 0, command, durationMs: 165 };
    return JSON.stringify({ type: "attachment", uuid: "h1", parentUuid: "r1", sessionId: "sA", timestamp: FIRST_ATTUNE_REWRITE_TIME, attachment });
}

function makeRewrite(toolUseId: string, command: string, stdout: string): AttachmentEntry {
    const record = JSON.parse(makeHookSuccessLine(toolUseId, command, stdout));
    record.timestamp = new Date(record.timestamp);
    return getAttachmentEntry(record) as AttachmentEntry;
}

test("test_collectPostToolHookRewrites_finds_the_rewrite_record_of_a_tool_use_on_index_lines", (t) => {
    // Scenario: line 441 of the Attune session is a hook_success record that says the hook rewrote a file after the Edit toolu_e1.
    const folder = makeTempFolder(t);
    const rewriteLine = makeHookSuccessLine("toolu_e1", REFLOW_COMMENTS_STATUS_MESSAGE, makeRewriteStdout("/x/index.html", [13]));
    // A hook_success record of a hook that rewrote nothing is not a rewrite.
    const quietLine = makeHookSuccessLine("toolu_e2", REFLOW_COMMENTS_STATUS_MESSAGE, "");
    // The index line of any other attachment kind keeps no attachment payload.
    const reminderLine = JSON.stringify({ type: "attachment", uuid: "h3", parentUuid: "h1", sessionId: "sA", timestamp: FIRST_ATTUNE_REWRITE_TIME, attachment: { type: "total_tokens_reminder", text: "left" } });
    writeFileSync(join(folder, "sA.jsonl"), [rewriteLine, quietLine, reminderLine].join("\n") + "\n");
    // The collect step reads the index lines that the replay loads.
    const rewrites = collectPostToolHookRewrites(loadJSONLLineIndex([folder]).indexLines);
    // Only the rewrite record is kept, under the tool use id of its Edit.
    assert.deepEqual([...rewrites.keys()], ["toolu_e1"]);
    assert.equal(rewrites.get("toolu_e1")?.attachment.command, REFLOW_COMMENTS_STATUS_MESSAGE);
});

test("test_runRecordedPostToolHook_rewrites_the_file_like_the_mac_hook_did", (t) => {
    // Scenario: the Edit left a one-line HTML comment; on the Mac the taskTools reflow hook of that day split it into 3 lines.
    const file = join(makeTempFolder(t), "index.html");
    writeFileSync(file, ONE_LINE_COMMENT_TEXT);
    const rewrite = makeRewrite("toolu_e1", REFLOW_COMMENTS_STATUS_MESSAGE, makeRewriteStdout(file, [3]));
    // The replay runs the real hook on the file.
    runRecordedPostToolHook(file, rewrite);
    // The file now holds the hook's text.
    assert.equal(readFileSync(file, "utf8"), REFLOWED_COMMENT_TEXT);
});

test("test_runRecordedPostToolHook_throws_when_the_hook_output_differs_from_the_record", (t) => {
    // Scenario: the record says line 7 was rewritten, but the hook rewrites line 3.
    const file = join(makeTempFolder(t), "index.html");
    writeFileSync(file, ONE_LINE_COMMENT_TEXT);
    const rewrite = makeRewrite("toolu_e1", REFLOW_COMMENTS_STATUS_MESSAGE, makeRewriteStdout(file, [7]));
    // The replay stops loudly.
    assert.throws(() => runRecordedPostToolHook(file, rewrite), /differs from the recorded output/);
});

test("test_runRecordedPostToolHook_throws_for_a_hook_command_with_no_replay_rule", (t) => {
    // Scenario: a rewrite record of the claude_hooks dispatcher, which the replay cannot run yet.
    const file = join(makeTempFolder(t), "index.html");
    writeFileSync(file, ONE_LINE_COMMENT_TEXT);
    const dispatcherCommand = "node \"${CLAUDE_PLUGIN_ROOT}/dispatcher/dispatch.ts\"";
    const rewrite = makeRewrite("toolu_e1", dispatcherCommand, makeRewriteStdout(file, [3]));
    // The replay stops loudly and names the command.
    assert.throws(() => runRecordedPostToolHook(file, rewrite), /no replay rule for the PostToolUse hook "node "\$\{CLAUDE_PLUGIN_ROOT\}\/dispatcher\/dispatch\.ts""/);
    // The file is left as the Edit wrote it.
    assert.equal(readFileSync(file, "utf8"), ONE_LINE_COMMENT_TEXT);
});

const DOTFILES_HOOK_COMMAND = "node ${HOME}/.claude/hooks/dotfiles-hooks.ts";
const ATTUNE_SUBAGENT_STOP_REFORMAT_TIME = "2026-10-06T15:59:41.615Z";
const ONE_LINE_FINALLY_TEXT = "try {\n  run();\n} finally {\n  stop();\n}\n";
const SPLIT_FINALLY_TEXT = "try {\n  run();\n}\nfinally {\n  stop();\n}\n";

function makeReformatStdout(files: string[]): string {
    const additionalContext = `This hook reformatted these files to the house layout: ${files.join(", ")}. Do not revert that reformatting.`;
    return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStop", additionalContext } })}\n`;
}

function makeStopHookRecord(hookEvent: string, command: string, stdout: string): AttachmentEntry {
    const attachment = { type: "hook_success", hookName: hookEvent, toolUseID: "d9972cf6", hookEvent, content: "", stdout, stderr: "", exitCode: 0, command, durationMs: 2016 };
    const record = { type: "attachment", uuid: "h1", parentUuid: "r1", sessionId: "sA", timestamp: new Date(ATTUNE_SUBAGENT_STOP_REFORMAT_TIME), attachment };
    return getAttachmentEntry(record as never) as AttachmentEntry;
}

test("test_listStopHookReformattedFiles_reads_the_files_a_stop_hook_record_names", () => {
    // Scenario: line 179 of subagent agent-abd0845e1293e1692 says the dotfiles SubagentStop hook reformatted two files.
    const record = makeStopHookRecord("SubagentStop", DOTFILES_HOOK_COMMAND, makeReformatStdout(["/x/server.ts", "/x/app.ts"]));
    // Both files are listed, in record order.
    assert.deepEqual(listStopHookReformattedFiles(record), ["/x/server.ts", "/x/app.ts"]);
    // A PostToolUse record with the same text is not a stop hook record.
    const postToolRecord = makeStopHookRecord("PostToolUse", DOTFILES_HOOK_COMMAND, makeReformatStdout(["/x/server.ts"]));
    assert.deepEqual(listStopHookReformattedFiles(postToolRecord), []);
    // A stop hook record that reformatted nothing lists no file.
    const quietRecord = makeStopHookRecord("Stop", DOTFILES_HOOK_COMMAND, "");
    assert.deepEqual(listStopHookReformattedFiles(quietRecord), []);
});

test("test_listStopHookReformattedFiles_reads_the_files_a_blocking_stop_hook_record_names", () => {
    // Scenario: line 30 of subagent agent-ae8c91bca6e985474 says the dotfiles SubagentStop hook reformatted a file and then blocked the stop.
    const blockingErrorText = "This hook reformatted these files to the house layout: /x/makeSession.ts. Do not revert that reformatting.\nStyle debt is 1 and must drop below 0.";
    const attachment = { type: "hook_blocking_error", hookName: "SubagentStop", toolUseID: "10c1c809", hookEvent: "SubagentStop", blockingError: { blockingError: blockingErrorText, command: DOTFILES_HOOK_COMMAND } };
    const record = getAttachmentEntry({ type: "attachment", uuid: "h1", parentUuid: "r1", sessionId: "sA", timestamp: new Date("2026-10-06T16:03:15.533Z"), attachment } as never) as AttachmentEntry;
    // The file the record names is listed.
    assert.deepEqual(listStopHookReformattedFiles(record), ["/x/makeSession.ts"]);
});

test("test_runRecordedStopHookReformat_splits_a_finally_line_like_the_mac_hook_did", (t) => {
    // Scenario: the subagent left `} finally {` on one line; on the Mac the dotfiles eslint --fix of that day split it.
    const file = join(makeTempFolder(t), "server.ts");
    writeFileSync(file, ONE_LINE_FINALLY_TEXT);
    const record = makeStopHookRecord("SubagentStop", DOTFILES_HOOK_COMMAND, makeReformatStdout([file]));
    // The replay runs the hook's eslint --fix on the file.
    runRecordedStopHookReformat(file, record);
    // The file now holds `}` and `finally {` on two lines.
    assert.equal(readFileSync(file, "utf8"), SPLIT_FINALLY_TEXT);
});

test("test_runRecordedStopHookReformat_throws_when_eslint_changes_nothing", (t) => {
    // Scenario: the record says the file was reformatted, but the replayed file is already in the house layout.
    const file = join(makeTempFolder(t), "server.ts");
    writeFileSync(file, SPLIT_FINALLY_TEXT);
    const record = makeStopHookRecord("SubagentStop", DOTFILES_HOOK_COMMAND, makeReformatStdout([file]));
    // The replay stops loudly.
    assert.throws(() => runRecordedStopHookReformat(file, record), /changed nothing/);
});
