// Placement stage entry points for git-evidence splicing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGitCommitEvidence, findLastAddOfTarget } from "../src/reconstruction_git_placement.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const emptyReader: BackupReader = () => "";

function buildBashRecord(command: string, timestamp: string, cwd: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: new Path(cwd),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

test("test_findLastAddOfTarget_returns_the_latest_add_of_that_target_only", () => {
    const records = [
        buildBashRecord("git add a.txt", "2026-01-01T00:10:00Z", "/tmp/repo"),
        buildBashRecord("git add b.txt", "2026-01-01T00:30:00Z", "/tmp/repo"),
        buildBashRecord("git add a.txt", "2026-01-01T00:20:00Z", "/tmp/repo"),
    ];
    const last = findLastAddOfTarget(records, new Path("/tmp/repo/a.txt"));
    assert.equal(last!.timestamp.toISOString(), "2026-01-01T00:20:00.000Z");
    assert.equal(findLastAddOfTarget(records, new Path("/tmp/repo/c.txt")), undefined);
});

test("test_applyGitCommitEvidence_returns_events_when_no_git_evidence_exists", () => {
    const target = new Path("/tmp/repo/a.txt");
    const events: FileEvent[] = [{ kind: EventKind.write, changeId: new Uuid("w"), target, content: "a\n", timestamp: new Date("2026-01-01T00:00:00Z") }];
    assert.equal(applyGitCommitEvidence([], events, emptyReader, target), events);
});
