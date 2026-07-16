import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { parseRedirect } from "../src/reconstruction_bash_events.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { AppendEvent, OverwriteEvent } from "../src/reconstruction_engine.ts";
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

// One assistant record running `git mv a.py b.py` with the transcript cwd set to /work — the
// shape `collectEventsFromRecord` reads cwd from to resolve the rename's relative paths.
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

// `git mv a.py b.py` issued with cwd /work extracts to one rename whose from/to are resolved
// absolute against that cwd — so the rename can later link to the absolute Write/Edit targets.
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
