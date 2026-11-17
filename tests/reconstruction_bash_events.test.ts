import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
// import { parseRedirect, parseStdoutRedirect } from "../src/reconstruction_bash_events.ts";
import { parseRedirect, parseRmTargets, parseStdoutRedirect } from "../src/reconstruction_bash_events.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { AppendEvent, OverwriteEvent } from "../src/reconstruction_events.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// A synthetic Bash tool_use content block running `command`.
function buildBashBlock(id: string, command: string): Record<string, unknown> {
    return {
        type: BlockType.tool_use,
        id,
        name: ToolName.Bash,
        input: { command },
        caller: { type: "direct" },
    };
}

// A synthetic assistant record carrying one Bash tool_use whose command is `command`.
function buildBashRecord(id: string, command: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [buildBashBlock(id, command)] },
    } as unknown as TranscriptRecord;
}

// One assistant record running `git mv a.py b.py` with record cwd /work.
function buildGitMvRecords(): TranscriptRecord[] {
    return [
        {
            type: RecordType.assistant,
            timestamp: new Date("2026-01-01T00:00:10Z"),
            cwd: new Path("/work"),
            message: { content: [buildBashBlock("toolu_gitmv", "git mv a.py b.py")] },
        } as unknown as TranscriptRecord,
    ];
}

// `git mv a.py b.py` with cwd /work gives one rename with absolute from/to paths.
test("test_extract_maps_git_mv_to_a_rename_with_cwd_resolved_paths", () => {
    // Build one assistant record: a Bash tool_use `git mv a.py b.py`, on a record whose cwd is /work.
    const records = buildGitMvRecords();
    // Extract the file events from that record.
    const events = extractFileEvents(records);
    // Exactly one event is produced, and it is a rename — git mv is recognized like a plain mv.
    assert.equal(events.length, 1);
    const rename = events.find((event) => event.kind === EventKind.rename)!;
    // The relative args were resolved against cwd, so both endpoints are absolute under /work.
    assert.equal(rename.from.toString(), "/work/a.py");
    assert.equal(rename.to.toString(), "/work/b.py");
});

// One `>>` then one `>` redirect to /a/f.txt, in timestamp order.
function buildRedirectRecords(): TranscriptRecord[] {
    return [
        buildBashRecord("toolu_app", 'echo "line two" >> /a/f.txt', "2026-01-01T00:00:10Z"),
        buildBashRecord("toolu_ovr", 'echo "replaced content" > /a/f.txt', "2026-01-01T00:00:20Z"),
    ];
}

// `>>` extracts an append event; `>` an overwrite event — both with empty content and the redirect target.
test("test_extract_maps_redirects_to_append_and_overwrite_events", () => {
    const events = extractFileEvents(buildRedirectRecords());
    const append = events.find((event) => event.kind === EventKind.append)!;
    const overwrite = events.find((event) => event.kind === EventKind.overwrite)!;
    // Both target the redirected file; neither carries content yet (the sidecar fills it).
    assert.equal(append.target.toString(), "/a/f.txt");
    assert.equal((append as AppendEvent).content, "");
    assert.equal(overwrite.target.toString(), "/a/f.txt");
    assert.equal((overwrite as OverwriteEvent).content, "");
});

// task 76 — `> /dev/null` discards output; it must not parse as a file redirect.
test("test_parseRedirect_ignores_the_null_device", () => {
    assert.equal(parseRedirect("python build.py > /dev/null"), undefined);
    assert.equal(parseRedirect("python build.py >> /dev/null"), undefined);
    // A real target still parses.
    assert.equal(parseRedirect("echo hi > /a/f.txt")!.target.toString(), "/a/f.txt");
});

// task 150: the `>` inside a JS arrow must not become a redirect target.
test("test_parseRedirect_rejects_a_js_arrow_inside_a_node_one_liner", () => {
    // The `=>` is the last `>`, followed by one token to the end.
    assert.equal(parseRedirect("node -e \"console.log(tasks.map(x => x.taskNumber).join(','))\""), undefined);
});

// task 150 — a candidate carrying shell/JS punctuation is command text, not a path.
test("test_parseRedirect_rejects_targets_containing_shell_or_js_punctuation", () => {
    // Parentheses mark an expression fragment, not a filename.
    assert.equal(parseRedirect("echo hi > out(1).txt"), undefined);
    // A quote can only reach the target token by mis-splitting quoted command text.
    assert.equal(parseRedirect("echo hi > \"quoted.txt\""), undefined);
    // A comma marks an argument list fragment.
    assert.equal(parseRedirect("echo hi > a,b.txt"), undefined);
});

// task 150 — the filter must not over-reject: plain and absolute targets still parse.
test("test_parseRedirect_still_accepts_plain_and_absolute_targets", () => {
    // A bare relative filename overwrite target parses.
    assert.equal(parseRedirect("echo hi > out.txt")!.target.toString(), "out.txt");
    // An absolute append target parses and is flagged as appending.
    const appended = parseRedirect("echo hi >> /a/log.txt")!;
    assert.equal(appended.target.toString(), "/a/log.txt");
    assert.equal(appended.appends, true);
});

// parseStdoutRedirect ignores a trailing stderr redirect and finds the stdout file.
test("test_parseStdoutRedirect_finds_stdout_file_past_stderr_redirects", () => {
    const overwritten = parseStdoutRedirect("python3 audit/x.py > docs/design/call_graph.md 2> /tmp/cg.err")!;
    assert.equal(overwritten.target.toString(), "docs/design/call_graph.md");
    assert.equal(overwritten.appends, false);
    const appended = parseStdoutRedirect("python3 x.py >> log.txt")!;
    assert.equal(appended.target.toString(), "log.txt");
    assert.equal(appended.appends, true);
    assert.equal(parseStdoutRedirect("python3 x.py | tail -40"), undefined);
    assert.equal(parseStdoutRedirect("python3 x.py 2>&1 | tail -10"), undefined);
    assert.equal(parseStdoutRedirect("python3 x.py > /dev/null"), undefined);
});

// The text of each rm target path that parseRmTargets finds in `command`.
function listRmTargetTexts(command: string): string[] {
    return parseRmTargets(command).map((target) => target.toString());
}

test("test_parseRmTargets_gives_both_paths_of_a_plain_rm", () => {
    // Two plain paths after rm are both targets.
    assert.deepEqual(listRmTargetTexts("rm a.py b.py"), ["a.py", "b.py"]);
});

test("test_parseRmTargets_ends_the_list_at_a_double_ampersand", () => {
    // Words after && belong to the next command, not to rm.
    assert.deepEqual(listRmTargetTexts("rm /tmp/migrate-nnn-to-timestamp.py && ls /tmp/migrate-nnn-to-timestamp.py 2>&1; echo done"), ["/tmp/migrate-nnn-to-timestamp.py"]);
});

test("test_parseRmTargets_skips_flags_and_ends_the_list_at_a_double_ampersand", () => {
    // The -rf flag is skipped and the words after && are not targets.
    assert.deepEqual(listRmTargetTexts("rm -rf /tmp/plate-live.bWFRfk/.plate && git -C /tmp/plate-live.bWFRfk checkout -- .gitignore 2>/dev/null"), ["/tmp/plate-live.bWFRfk/.plate"]);
});

test("test_parseRmTargets_ends_the_list_at_a_redirect_word", () => {
    // The 2>/dev/null word ends the list, so echo and done are not targets.
    assert.deepEqual(listRmTargetTexts("rm /tmp/plate_commit_3files.py /tmp/plate_manual_commit.py 2>/dev/null; echo done"), ["/tmp/plate_commit_3files.py", "/tmp/plate_manual_commit.py"]);
});

test("test_parseRmTargets_ends_the_list_at_a_stderr_to_stdout_redirect_word", () => {
    // The 2>&1 word ends the list, so echo and done are not targets.
    assert.deepEqual(listRmTargetTexts("rm a.py 2>&1; echo done"), ["a.py"]);
});

test("test_parseRmTargets_keeps_the_path_that_ends_with_a_semicolon_and_stops_there", () => {
    // The path before the semicolon is a target, and echo and done are not.
    assert.deepEqual(listRmTargetTexts("rm a.py; echo done"), ["a.py"]);
});

test("test_parseRmTargets_ends_the_list_at_a_pipe", () => {
    // Words after the pipe belong to the next command, not to rm.
    assert.deepEqual(listRmTargetTexts("rm a.py | grep x"), ["a.py"]);
});

test("test_parseRmTargets_skips_the_flag_of_rm_minus_rf", () => {
    // The -rf flag is not a target, only build is.
    assert.deepEqual(listRmTargetTexts("rm -rf build"), ["build"]);
});

test("test_parseRmTargets_ends_the_list_at_a_double_pipe", () => {
    // Words after || belong to the next command, not to rm.
    assert.deepEqual(listRmTargetTexts("rm a.py || echo failed"), ["a.py"]);
});
