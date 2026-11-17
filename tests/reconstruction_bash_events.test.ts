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

// Moved to tests/reconstruction_bash_split.test.ts: the joiner cut is done by splitCommandLineAtJoiners.
// test("test_parseRmTargets_ends_the_list_at_a_double_ampersand", () => {
//     // Words after && belong to the next command, not to rm.
//     assert.deepEqual(listRmTargetTexts("rm /tmp/migrate-nnn-to-timestamp.py && ls /tmp/migrate-nnn-to-timestamp.py 2>&1; echo done"), ["/tmp/migrate-nnn-to-timestamp.py"]);
// });

// Moved to tests/reconstruction_bash_split.test.ts: the joiner cut is done by splitCommandLineAtJoiners.
// test("test_parseRmTargets_skips_flags_and_ends_the_list_at_a_double_ampersand", () => {
//     // The -rf flag is skipped and the words after && are not targets.
//     assert.deepEqual(listRmTargetTexts("rm -rf /tmp/plate-live.bWFRfk/.plate && git -C /tmp/plate-live.bWFRfk checkout -- .gitignore 2>/dev/null"), ["/tmp/plate-live.bWFRfk/.plate"]);
// });

test("test_parseRmTargets_ends_the_list_at_a_redirect_word", () => {
    // The 2>/dev/null word ends the list, so echo and done are not targets.
    assert.deepEqual(listRmTargetTexts("rm /tmp/plate_commit_3files.py /tmp/plate_manual_commit.py 2>/dev/null; echo done"), ["/tmp/plate_commit_3files.py", "/tmp/plate_manual_commit.py"]);
});

test("test_parseRmTargets_ends_the_list_at_a_stderr_to_stdout_redirect_word", () => {
    // The 2>&1 word ends the list, so echo and done are not targets.
    assert.deepEqual(listRmTargetTexts("rm a.py 2>&1; echo done"), ["a.py"]);
});

// Moved to tests/reconstruction_bash_split.test.ts: the joiner cut is done by splitCommandLineAtJoiners.
// test("test_parseRmTargets_keeps_the_path_that_ends_with_a_semicolon_and_stops_there", () => {
//     // The path before the semicolon is a target, and echo and done are not.
//     assert.deepEqual(listRmTargetTexts("rm a.py; echo done"), ["a.py"]);
// });

// Moved to tests/reconstruction_bash_split.test.ts: the joiner cut is done by splitCommandLineAtJoiners.
// test("test_parseRmTargets_ends_the_list_at_a_pipe", () => {
//     // Words after the pipe belong to the next command, not to rm.
//     assert.deepEqual(listRmTargetTexts("rm a.py | grep x"), ["a.py"]);
// });

test("test_parseRmTargets_skips_the_flag_of_rm_minus_rf", () => {
    // The -rf flag is not a target, only build is.
    assert.deepEqual(listRmTargetTexts("rm -rf build"), ["build"]);
});

// Moved to tests/reconstruction_bash_split.test.ts: the joiner cut is done by splitCommandLineAtJoiners.
// test("test_parseRmTargets_ends_the_list_at_a_double_pipe", () => {
//     // Words after || belong to the next command, not to rm.
//     assert.deepEqual(listRmTargetTexts("rm a.py || echo failed"), ["a.py"]);
// });

// One assistant record running `command`, with record cwd /work.
function buildBashRecordWithCwd(id: string, command: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date("2026-01-01T00:00:10Z"),
        cwd: new Path("/work"),
        message: { content: [buildBashBlock(id, command)] },
    } as unknown as TranscriptRecord;
}

test("test_extract_gives_a_delete_for_each_of_two_rm_commands_joined_by_a_double_ampersand", () => {
    // Extract the events of `rm a.py && rm b.py`.
    const events = extractFileEvents([buildBashRecord("toolu_rm2", "rm a.py && rm b.py", "2026-01-01T00:00:10Z")]);
    // Two delete events come out, a.py first and b.py second.
    assert.deepEqual(events.map((event) => event.kind), [EventKind.delete, EventKind.delete]);
    assert.deepEqual(events.map((event) => (event as { target: Path }).target.toString()), ["a.py", "b.py"]);
});

test("test_extract_gives_the_rm_after_a_first_command_that_is_not_rm", () => {
    // Extract the events of `ls && rm a.py`.
    const events = extractFileEvents([buildBashRecord("toolu_lsrm", "ls && rm a.py", "2026-01-01T00:00:10Z")]);
    // One delete event comes out, for a.py.
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.delete);
    assert.equal((events[0] as { target: Path }).target.toString(), "a.py");
});

test("test_extract_gives_two_renames_for_two_mv_commands_joined_by_a_double_ampersand", () => {
    // Extract the events of `mv a b && mv c d` with cwd /work.
    const events = extractFileEvents([buildBashRecordWithCwd("toolu_mv2", "mv a b && mv c d")]);
    // Two rename events come out, a to b first and c to d second, with cwd-resolved paths.
    assert.deepEqual(events.map((event) => event.kind), [EventKind.rename, EventKind.rename]);
    const renames = events as unknown as { from: Path; to: Path }[];
    assert.deepEqual(renames.map((rename) => rename.from.toString()), ["/work/a", "/work/c"]);
    assert.deepEqual(renames.map((rename) => rename.to.toString()), ["/work/b", "/work/d"]);
});

test("test_extract_gives_a_copy_then_a_delete_for_cp_and_rm_joined_by_a_semicolon", () => {
    // Extract the events of `cp a b; rm a`.
    const events = extractFileEvents([buildBashRecord("toolu_cprm", "cp a b; rm a", "2026-01-01T00:00:10Z")]);
    // A copy event comes first, then a delete event.
    assert.deepEqual(events.map((event) => event.kind), [EventKind.copy, EventKind.delete]);
    // The copy goes from a to b, and the delete targets a.
    const copy = events[0] as unknown as { from: Path; to: Path };
    assert.equal(copy.from.toString(), "a");
    assert.equal(copy.to.toString(), "b");
    assert.equal((events[1] as { target: Path }).target.toString(), "a");
});

test("test_extract_gives_the_overwrite_of_a_redirect_followed_by_another_command", () => {
    // Extract the events of `echo x > f && ls`.
    const events = extractFileEvents([buildBashRecord("toolu_redls", "echo x > f && ls", "2026-01-01T00:00:10Z")]);
    // One overwrite event comes out, for f.
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.overwrite);
    assert.equal((events[0] as OverwriteEvent).target.toString(), "f");
});

test("test_extract_gives_a_delete_for_each_of_two_rm_commands_on_two_lines", () => {
    // Extract the events of two rm commands on two lines.
    const events = extractFileEvents([buildBashRecord("toolu_rmlines", "rm a\nrm b", "2026-01-01T00:00:10Z")]);
    // Two delete events come out, a first and b second.
    assert.deepEqual(events.map((event) => event.kind), [EventKind.delete, EventKind.delete]);
    assert.deepEqual(events.map((event) => (event as { target: Path }).target.toString()), ["a", "b"]);
});

test("test_extract_keeps_a_joiner_inside_double_quotes_in_one_command", () => {
    // Extract the events of an echo whose quoted text holds &&.
    const events = extractFileEvents([buildBashRecord("toolu_quote", 'echo "a && b" > out.txt', "2026-01-01T00:00:10Z")]);
    // Exactly one overwrite event comes out, for out.txt.
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.overwrite);
    assert.equal((events[0] as OverwriteEvent).target.toString(), "out.txt");
});

test("test_extract_gives_no_event_for_an_rm_inside_a_heredoc_body", () => {
    // Extract the events of a heredoc whose body holds `rm z`.
    const events = extractFileEvents([buildBashRecord("toolu_heredoc", "cat > f.txt <<'EOF'\nrm z\nEOF", "2026-01-01T00:00:10Z")]);
    // No delete event comes out.
    assert.equal(events.some((event) => event.kind === EventKind.delete), false);
});
