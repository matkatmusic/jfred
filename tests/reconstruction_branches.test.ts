import { test } from "node:test";
import assert from "node:assert/strict";
import {
    collectAcceptedUserEditIds,
    extractRenderableEvents,
} from "../src/reconstruction_renderable.ts";
import { reconstructAll, reconstructBranches, reconstructFile } from "../src/reconstruction_engine.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import {
    clearReconstructionFailures,
    drainReconstructionFailures,
} from "../src/reconstruction_health.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { EventKind, FailureScope } from "../src/structures/vocabulary.ts";
import { loadRecords } from "./utilities.ts";
import { S13_JSONL, S15_JSONL, S19_JSONL } from "./fixtures.ts";

// An `edited_text_file` snapshot counts as a change only when its content differs from the file's current content.
test("test_collectAcceptedUserEditIds_includes_the_genuine_S15_user_edit", () => {
    const accepted = collectAcceptedUserEditIds(loadRecords(S15_JSONL));
    // The specific changeId rotates on re-run, so only the count is pinned.
    assert.equal(accepted.size, 1);
});

// S13's `edited_text_file` echoes the restored `greet` content, so it is a disk echo, not an edit.
test("test_collectAcceptedUserEditIds_excludes_the_S13_disk_echo", () => {
    const accepted = collectAcceptedUserEditIds(loadRecords(S13_JSONL));
    assert.equal(accepted.size, 0);
});

// The disk-echo edit must be dropped so views never show a phantom turn.
test("test_extractRenderableEvents_drops_the_S13_disk_echo_turn", () => {
    const records = loadRecords(S13_JSONL);
    const accepted = collectAcceptedUserEditIds(records);
    const renderable = extractRenderableEvents(records, accepted);
    assert.equal(renderable.filter((event) => event.kind === EventKind.userEdit).length, 0);
});

// S19 is reader-dependent: its edit-first file seeds its base from a backup blob, so a throwing reader gets touched.
test("test_reconstructFile_survives_a_throwing_reader_stage", () => {
    clearReconstructionFailures();
    const records = loadRecords(S19_JSONL);
    const expected = reconstructAll(records);
    assert.ok(expected.length > 0);
    const throwingReader: BackupReader = () => {
        throw new Error("ENOENT: blob gone");
    };
    for (const history of expected) {
        const revisions = reconstructFile(records, history.target, throwingReader);
        assert.deepStrictEqual(revisions, history.revisions);
    }
    const failures = drainReconstructionFailures();
    assert.ok(failures.some((failure) => failure.scope === FailureScope.fileStage));
});

// task 149: per-file chain stages used to run silently, freezing the console on the last label.
test("test_run_stage_tolerantly_announces_each_stage_through_the_progress_sink", () => {
    const capturedLabels: string[] = [];
    setReconstructionProgressSink((event) => capturedLabels.push(event.label));
    try {
        reconstructAll(loadRecords(S15_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // The first chain stage announced itself with the target and the stage name — the label keeps the `reconstructing ` prefix so the webapp's phase classifier stays in phase 4.
    assert.ok(capturedLabels.some((label) => /^reconstructing .+ — seedBaseCommitBeacon$/.test(label)));
});

// task 149: collectAcceptedUserEditIds re-runs the per-target loop once per conversation branch.
test("test_collect_accepted_user_edit_ids_announces_each_branch_pass", () => {
    const capturedLabels: string[] = [];
    setReconstructionProgressSink((event) => capturedLabels.push(event.label));
    try {
        collectAcceptedUserEditIds(loadRecords(S15_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // The first branch pass announces its position out of the enumerated branch count.
    assert.ok(capturedLabels.some((label) => /^reconstructing accepted user edits — branch 1\/\d+$/.test(label)));
});

test("test_extractRenderableEvents_keeps_the_genuine_S15_user_edit_turn", () => {
    const records = loadRecords(S15_JSONL);
    const accepted = collectAcceptedUserEditIds(records);
    const renderable = extractRenderableEvents(records, accepted);
    assert.equal(renderable.filter((event) => event.kind === EventKind.userEdit).length, 1);
});

// task 163: branch enumeration ran silently. S19 is a conv-rewind transcript, so it has at least one abandoned tip.
test("test_find_conversation_branches_announces_each_abandoned_tip_scan", () => {
    const capturedEvents: ProgressEvent[] = [];
    setReconstructionProgressSink((event) => capturedEvents.push(event));
    try {
        reconstructBranches(loadRecords(S19_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // Never compare total to the captured-event count: the pipeline re-enters findConversationBranches, so the same 1..N sequence can legitimately repeat.
    const tipScans = capturedEvents.filter((event) => event.label === "scanning branch tips");
    assert.ok(tipScans.length > 0);
    assert.equal(tipScans[0]!.current, 1);
    assert.ok(tipScans[0]!.total! >= 1);
});

// task 163: rewound-branch reconstruction carried no branch-level announcement.
test("test_reconstruct_branches_announces_each_rewound_branch", () => {
    const capturedEvents: ProgressEvent[] = [];
    setReconstructionProgressSink((event) => capturedEvents.push(event));
    try {
        reconstructBranches(loadRecords(S19_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // Same re-entrancy caveat as above: never compare total to the captured-event count.
    const rewoundEvents = capturedEvents.filter((event) => event.label === "reconstructing rewound branch");
    assert.ok(rewoundEvents.length > 0);
    assert.equal(rewoundEvents[0]!.current, 1);
    assert.ok(rewoundEvents[0]!.total! >= 1);
});

