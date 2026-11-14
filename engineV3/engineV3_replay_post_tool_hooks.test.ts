import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAttachmentEntry, type AttachmentEntry } from "../src/structures/session-meta.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { collectPostToolHookRewrites, runRecordedPostToolHook } from "./engineV3_replay_post_tool_hooks.ts";

const REFLOW_COMMENTS_STATUS_MESSAGE = "Reflowing wrapped comments...";
const FIRST_ATTUNE_REWRITE_TIME = "2026-10-06T15:15:40.402Z";
const ONE_LINE_COMMENT_TEXT = "<body>\n<!-- templates -->\n<div></div>\n</body>\n";
const REFLOWED_COMMENT_TEXT = "<body>\n<!--\n  templates\n-->\n<div></div>\n</body>\n";
// The typesafe-playground records label the claude_hooks dispatcher as "command hook 2"; the first one is the plugin command text.
const CLAUDE_HOOKS_LABELED_COMMAND = "command hook 2";
const CLAUDE_HOOKS_DISPATCHER_COMMAND = "node \"${CLAUDE_PLUGIN_ROOT}/dispatcher/dispatch.ts\"";
const FIRST_TYPESAFE_REWRITE_TIME = "2026-10-27T17:28:50.754Z";
const LABELED_COMMAND_REWRITE_TIME = "2026-11-05T22:40:37.580Z";
const WRAPPED_COMMENT_TEXT = "function a() {\n  // first part of the comment\n  // second part of the comment\n  return 1;\n}\n";
const JOINED_COMMENT_TEXT = "function a() {\n  // first part of the comment second part of the comment\n  return 1;\n}\n";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-post-tool-hooks-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeRewriteStdout(file: string, lines: number[]): string {
    const additionalContext = JSON.stringify({ information: "the following lines were rewritten by a hook after your edit", rewritten: [{ file, lines }] });
    return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } })}\n`;
}

function makeHookSuccessLine(toolUseId: string, command: string, stdout: string, timestamp: string = FIRST_ATTUNE_REWRITE_TIME): string {
    const attachment = { type: "hook_success", hookName: "PostToolUse:Edit", toolUseID: toolUseId, hookEvent: "PostToolUse", content: "", stdout, stderr: "", exitCode: 0, command, durationMs: 165 };
    return JSON.stringify({ type: "attachment", uuid: "h1", parentUuid: "r1", sessionId: "sA", timestamp, attachment });
}

function makeRewrite(toolUseId: string, command: string, stdout: string, timestamp: string = FIRST_ATTUNE_REWRITE_TIME): AttachmentEntry {
    const record = JSON.parse(makeHookSuccessLine(toolUseId, command, stdout, timestamp));
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
    // The collect step reads the lines that the replay loads.
    const rewrites = collectPostToolHookRewrites(loadMergedJSONLLines([folder]).jsonlLines);
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
    // Scenario: a rewrite record of a hook that no rule knows.
    const file = join(makeTempFolder(t), "index.html");
    writeFileSync(file, ONE_LINE_COMMENT_TEXT);
    const rewrite = makeRewrite("toolu_e1", "command hook 9", makeRewriteStdout(file, [3]));
    // The replay stops loudly and names the command.
    assert.throws(() => runRecordedPostToolHook(file, rewrite), /no replay rule for the PostToolUse hook "command hook 9"/);
    // The file is left as the Edit wrote it.
    assert.equal(readFileSync(file, "utf8"), ONE_LINE_COMMENT_TEXT);
});

test("test_runRecordedPostToolHook_joins_a_wrapped_comment_like_the_claude_hooks_hook_labeled_command_hook_2", (t) => {
    // Scenario: on 2026-11-05 the Edit left two // lines of one sentence; the claude_hooks comment hook joined them onto one line.
    const file = join(makeTempFolder(t), "a.ts");
    writeFileSync(file, WRAPPED_COMMENT_TEXT);
    const rewrite = makeRewrite("toolu_e1", CLAUDE_HOOKS_LABELED_COMMAND, makeRewriteStdout(file, [2]), LABELED_COMMAND_REWRITE_TIME);
    // The replay runs the real claude_hooks hook of that day on the file.
    runRecordedPostToolHook(file, rewrite);
    // The file now holds the hook's text.
    assert.equal(readFileSync(file, "utf8"), JOINED_COMMENT_TEXT);
});

test("test_runRecordedPostToolHook_joins_a_wrapped_comment_like_the_claude_hooks_plugin_dispatcher_command", (t) => {
    // Scenario: on 2026-10-27 the record names the plugin command of the dispatcher, and the same comment hook joined the lines.
    const file = join(makeTempFolder(t), "a.ts");
    writeFileSync(file, WRAPPED_COMMENT_TEXT);
    const rewrite = makeRewrite("toolu_e1", CLAUDE_HOOKS_DISPATCHER_COMMAND, makeRewriteStdout(file, [2]), FIRST_TYPESAFE_REWRITE_TIME);
    runRecordedPostToolHook(file, rewrite);
    assert.equal(readFileSync(file, "utf8"), JOINED_COMMENT_TEXT);
});

test("test_runRecordedPostToolHook_throws_when_the_claude_hooks_output_differs_from_the_record", (t) => {
    // Scenario: the record says line 9 was rewritten, but the hook joins line 2.
    const file = join(makeTempFolder(t), "a.ts");
    writeFileSync(file, WRAPPED_COMMENT_TEXT);
    const rewrite = makeRewrite("toolu_e1", CLAUDE_HOOKS_LABELED_COMMAND, makeRewriteStdout(file, [9]), LABELED_COMMAND_REWRITE_TIME);
    // The replay stops loudly.
    assert.throws(() => runRecordedPostToolHook(file, rewrite), /claude_hooks .* hook output on .* differs from the recorded output/);
});
