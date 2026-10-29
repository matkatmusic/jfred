// findGitCommitEvents and findGitAddEvents: parse commits and explicit adds from Bash commands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findGitAddEvents, findGitCommitEvents } from "../src/reconstruction_git_commit_events.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

function buildBashRecord(command: string, timestamp: string, cwd: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: new Path(cwd),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

test("test_findGitCommitEvents_uses_dash_C_dir_else_record_cwd", () => {
    const records = [
        buildBashRecord('git commit -m "a"', "2026-01-01T00:00:00Z", "/tmp/repo"),
        buildBashRecord('git -C /other commit -m "b"', "2026-01-01T00:01:00Z", "/tmp/repo"),
        buildBashRecord("ls", "2026-01-01T00:02:00Z", "/tmp/repo"),
    ];
    const commits = findGitCommitEvents(records);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]!.cwd?.toString(), "/tmp/repo");
    assert.equal(commits[1]!.cwd?.toString(), "/other");
    assert.equal(findGitCommitEvents(records), commits);
});

test("test_findGitAddEvents_skips_flags_and_dot_and_resolves_paths", () => {
    const records = [
        buildBashRecord("git add -A . src/a.ts", "2026-01-01T00:00:00Z", "/tmp/repo"),
        buildBashRecord("echo hi", "2026-01-01T00:01:00Z", "/tmp/repo"),
    ];
    const adds = findGitAddEvents(records);
    assert.equal(adds.length, 1);
    assert.equal(adds[0]!.path.toString(),"/tmp/repo/src/a.ts");
    assert.equal(findGitAddEvents(records), adds);
});
