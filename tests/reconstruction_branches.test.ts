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

// The accepted set is the engine's single source of truth for "which user edits are real changes":
// an `edited_text_file` snapshot becomes a change only when its content differs from the file's current
// content. S15's `# user edit` differs (a genuine edit), so its changeId is accepted.
test("test_collectAcceptedUserEditIds_includes_the_genuine_S15_user_edit", () => {
    // Collect the accepted user-edit changeIds for the S15 transcript.
    const accepted = collectAcceptedUserEditIds(loadRecords(S15_JSONL));
    // S15 has exactly one genuine, content-changing user edit (it added `# user edit`), so the accepted set
    // holds exactly one id. (The specific changeId rotates on re-run, so it isn't pinned here.)
    assert.equal(accepted.size, 1);
});

// S13's `edited_text_file` snapshot echoes the read branch's restored `greet` content — it changes
// nothing, so it is NOT accepted (a redundant disk echo, not a user edit).
test("test_collectAcceptedUserEditIds_excludes_the_S13_disk_echo", () => {
    // Collect the accepted user-edit changeIds for the S13 transcript.
    const accepted = collectAcceptedUserEditIds(loadRecords(S13_JSONL));
    // S13's only `edited_text_file` is a disk echo that matched current content, so it records NO change:
    // the accepted set is empty. (Asserting the empty set is re-run-stable; the old id pin was not.)
    assert.equal(accepted.size, 0);
});

// extractRenderableEvents drops the redundant disk-echo user edit so views never show a phantom turn:
// S13's events carry no user-edit turn once filtered by the accepted set.
test("test_extractRenderableEvents_drops_the_S13_disk_echo_turn", () => {
    // Filter the S13 transcript's events through its accepted set.
    const records = loadRecords(S13_JSONL);
    const accepted = collectAcceptedUserEditIds(records);
    const renderable = extractRenderableEvents(records, accepted);
    // No user-edit turn survives (the only edited_text_file was a no-op echo).
    assert.equal(renderable.filter((event) => event.kind === EventKind.userEdit).length, 0);
});

// A reader-gated chain stage that throws (a dead sidecar blob) must not kill the file:
// runStageTolerantly falls back to the stage's unmodified input events, so the revisions equal
// the reader-less reconstruction of the same records, and the survived failure is noted for the
// wire document. S19 is reader-DEPENDENT (its surviving edit-first file seeds its base from a
// backup blob), so the throwing reader is guaranteed to be touched.
test("test_reconstructFile_survives_a_throwing_reader_stage", () => {
    clearReconstructionFailures();
    const records = loadRecords(S19_JSONL);
    // The reader-less reconstruction is the expected fallback shape (every reader-gated stage skipped).
    const expected = reconstructAll(records);
    assert.ok(expected.length > 0);
    // A reader whose every read throws — the sidecar backup blob is gone.
    const throwingReader: BackupReader = () => {
        throw new Error("ENOENT: blob gone");
    };
    for (const history of expected) {
        const revisions = reconstructFile(records, history.target, throwingReader);
        assert.deepStrictEqual(revisions, history.revisions);
    }
    // The stage that touched the dead blob was noted as a survived per-stage failure.
    const failures = drainReconstructionFailures();
    assert.ok(failures.some((failure) => failure.scope === FailureScope.fileStage));
});

// task 149: the nine per-file chain stages were silent — the console froze on the last
// `reconstructing <target> n/n` label while the whole stage chain ground on. Every stage now
// announces through the progress sink before it runs.
test("test_run_stage_tolerantly_announces_each_stage_through_the_progress_sink", () => {
    // Install a capturing progress sink around a reconstruction of the S15 transcript.
    const capturedLabels: string[] = [];
    setReconstructionProgressSink((event) => capturedLabels.push(event.label));
    try {
        reconstructAll(loadRecords(S15_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // The first chain stage announced itself with the target and the stage name — the label
    // keeps the `reconstructing ` prefix so the webapp's phase classifier stays in phase 4.
    assert.ok(capturedLabels.some((label) => /^reconstructing .+ — seedBaseCommitBeacon$/.test(label)));
});

// task 149: collectAcceptedUserEditIds silently re-runs the whole per-target loop once per
// conversation branch — each branch pass now announces itself with its position.
test("test_collect_accepted_user_edit_ids_announces_each_branch_pass", () => {
    // Install a capturing progress sink around the accepted-set collection for S15 (one branch).
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

// extractRenderableEvents keeps the genuine S15 user edit as exactly one renderable turn.
test("test_extractRenderableEvents_keeps_the_genuine_S15_user_edit_turn", () => {
    // Filter the S15 transcript's events through its accepted set.
    const records = loadRecords(S15_JSONL);
    const accepted = collectAcceptedUserEditIds(records);
    const renderable = extractRenderableEvents(records, accepted);
    // Exactly one user-edit turn survives (the genuine content-changing edit).
    assert.equal(renderable.filter((event) => event.kind === EventKind.userEdit).length, 1);
});

// task 163: the branch enumeration ran silently between the "constructing branches" stage label
// and the first per-target counter — each abandoned-tip scan now announces its position.
test("test_find_conversation_branches_announces_each_abandoned_tip_scan", () => {
    // Install a capturing progress sink around a branch-aware reconstruction of S19
    // (a conv-rewind transcript: it has at least one abandoned tip).
    const capturedEvents: ProgressEvent[] = [];
    setReconstructionProgressSink((event) => capturedEvents.push(event));
    try {
        reconstructBranches(loadRecords(S19_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // The first tip scan announced itself as a counted event (current 1 of a positive total).
    // NOTE: totals are never compared against the captured-event count — the pipeline re-enters
    // findConversationBranches (per-branch accepted-edit passes, nested lineage replays), so the
    // same 1..N sequence can legitimately repeat.
    const tipScans = capturedEvents.filter((event) => event.label === "scanning branch tips");
    assert.ok(tipScans.length > 0);
    assert.equal(tipScans[0]!.current, 1);
    assert.ok(tipScans[0]!.total! >= 1);
});

// task 163: each rewound branch's reconstruction carried no branch-level announcement — the
// rewound pass now announces each branch as a counted event before reconstructing it.
test("test_reconstruct_branches_announces_each_rewound_branch", () => {
    // Install a capturing progress sink around a branch-aware reconstruction of S19.
    const capturedEvents: ProgressEvent[] = [];
    setReconstructionProgressSink((event) => capturedEvents.push(event));
    try {
        reconstructBranches(loadRecords(S19_JSONL));
    } finally {
        setReconstructionProgressSink(undefined);
    }
    // The first rewound branch announced its position out of a positive branch count.
    // (Same re-entrancy caveat as above: never compare total to the captured-event count.)
    const rewoundEvents = capturedEvents.filter((event) => event.label === "reconstructing rewound branch");
    assert.ok(rewoundEvents.length > 0);
    assert.equal(rewoundEvents[0]!.current, 1);
    assert.ok(rewoundEvents[0]!.total! >= 1);
});

