// Unit tests for the pure JSON builders (src/reconstruction_json.ts), Steps 1–4 of the JSON-output
// plan. Same shape as tests/reconstruction_steps_changes.test.ts: loadRecords + S19_JSONL.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    extractConversationMessages,
    summarizeBranches,
    buildLineVerdicts,
    buildReconstructionDocument,
} from "../src/reconstruction_json.ts";
import { buildStepSnapshots } from "../src/reconstruction_json_steps.ts";
import {
    reconstructBranches,
    type FileHistory,
} from "../src/reconstruction_engine.ts";
import { countStepsInTranscript } from "../src/reconstruction_steps.ts";
import { isGenuineUserPrompt } from "../src/reconstruction_prompts.ts";
import { RecordType, BlockType, Verdict } from "../src/structures/vocabulary.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import {
    createSidecarReader,
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

function realReader(records: ReturnType<typeof loadRecords>): BackupReader | undefined {
    const sessionId = findSessionId(records);
    return sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
}

const records = loadRecords(S19_JSONL);
const reader = realReader(records);

test("test_extractConversationMessages_keeps_genuine_user_prompts", () => {
    // Behavior: every user message returned is a genuine prompt; tool-result user records are dropped.
    // Step: extract messages, then look at the user-role ones.
    const messages = extractConversationMessages(records);
    const userRecords = records.filter((r) => r.type === RecordType.user);
    const genuine = userRecords.filter((r) => isGenuineUserPrompt(r));
    const nonPrompt = userRecords.find((r) => !isGenuineUserPrompt(r));
    // Verify: each returned user message corresponds to a genuine prompt, and a non-prompt is absent.
    const returnedUserMessages = messages.filter((m) => m.role === RecordType.user);
    const returnedUserUuids = returnedUserMessages.map((m) => m.uuid?.toString());
    assert.equal(returnedUserUuids.length, genuine.length);
    if (nonPrompt !== undefined) {
        assert.ok(!returnedUserUuids.includes(nonPrompt.uuid?.toString()));
    }
});

test("test_extractConversationMessages_keeps_assistant_text_replies", () => {
    // Behavior: assistant replies with text are kept; a pure tool_use assistant turn (no text) is omitted.
    const messages = extractConversationMessages(records);
    const assistantMessages = messages.filter((m) => m.role === RecordType.assistant);
    // Verify: every assistant message carries non-empty text.
    assert.ok(assistantMessages.length > 0);
    for (const message of assistantMessages) {
        assert.notEqual(message.text, "");
    }
});

test("test_extractMessageText_reads_plain_string_user_content", () => {
    // Behavior: a user record whose message.content is a plain string yields that string as text.
    // Step: find such a record among the genuine prompts.
    const messages = extractConversationMessages(records);
    const stringPrompt = records.find((r) => {
        const message = r.message as { content?: unknown } | undefined;
        return isGenuineUserPrompt(r) && typeof message?.content === "string";
    });
    // Verify: its extracted message text equals the raw string content.
    if (stringPrompt !== undefined) {
        const raw = (stringPrompt.message as { content: string }).content;
        const built = messages.find((m) => m.uuid?.toString() === stringPrompt.uuid?.toString());
        assert.equal(built?.text, raw);
    }
});

test("test_extractMessageText_joins_assistant_text_blocks", () => {
    // Behavior: an assistant record with array content yields only its TextBlock texts.
    const messages = extractConversationMessages(records);
    const blockAssistant = records.find((r) => {
        const message = r.message as { content?: unknown } | undefined;
        return r.type === RecordType.assistant && Array.isArray(message?.content);
    });
    // Verify: its text is the join of the record's text blocks (no tool_use noise).
    if (blockAssistant !== undefined) {
        const blocks = (blockAssistant.message as { content: { type: string; text?: string }[] }).content;
        const textBlocks = blocks.filter((b) => b.type === BlockType.text);
        const blockTexts = textBlocks.map((b) => b.text);
        const expected = blockTexts.join("\n");
        const built = messages.find((m) => m.uuid?.toString() === blockAssistant.uuid?.toString());
        if (expected !== "") {
            assert.equal(built?.text, expected);
        }
    }
});

test("test_summarizeBranches_marks_surviving_branch_not_rewound", () => {
    // Behavior: the surviving branch is not rewound.
    const branches = summarizeBranches(records);
    const surviving = branches.filter((b) => b.isSurviving);
    // Verify: at least one surviving branch, and each has wasRewound === false.
    assert.ok(surviving.length >= 1);
    for (const branch of surviving) {
        assert.equal(branch.wasRewound, false);
    }
});

test("test_summarizeBranches_marks_abandoned_branch_rewound", () => {
    // Behavior: S19 has a rewound (abandoned) branch with a rewindPoint.
    const branches = summarizeBranches(records);
    const abandoned = branches.find((b) => !b.isSurviving);
    // Verify: it is flagged rewound and carries a rewindPoint.
    assert.ok(abandoned !== undefined);
    assert.equal(abandoned!.wasRewound, true);
    assert.notEqual(abandoned!.rewindPoint, undefined);
});

test("test_buildStepSnapshots_produce_skeleton_steps_without_file_contents", () => {
    // Behavior: a step snapshot carries index/when/changeIds/changedPaths but NO `files` map — the
    // per-step file contents are the O(steps × live-bytes) blow-up the wire-size fix removes.
    const { steps } = buildStepSnapshots(records, reader, undefined);
    // Verify: skeleton fields present, files absent (compile-time: StepSnapshot has no `files`).
    assert.ok(steps.length > 0);
    for (const step of steps) {
        assert.equal(typeof step.index, "number");
        assert.ok(step.when instanceof Date);
        assert.ok(Array.isArray(step.changeIds));
        assert.ok(Array.isArray(step.changedPaths));
        assert.equal((step as Record<string, unknown>)["files"], undefined);
    }
});

test("test_buildReconstructionDocument_returns_branch_agnostic_histories_alongside_document", () => {
    // Behavior: the compact histories the steps derive from are returned NEXT TO the document, never as a
    // document field (a document field would be serialized onto the wire — the whole point of the fix).
    const branched = reconstructBranches(records, reader);
    const result = buildReconstructionDocument(records, branched, reader, undefined);
    // Verify: histories present alongside, and NOT a property of the wire document.
    assert.ok(result.stepFileHistories.length > 0);
    assert.ok(result.stepFileHistories.every((history) => Array.isArray(history.revisions)));
    assert.equal((result.document as Record<string, unknown>)["stepFileHistories"], undefined);
});

test("test_buildStepSnapshots_aligns_steps_with_change_ids", () => {
    // Behavior: one entry per step; index is 1-based and changeIds is a non-empty Uuid[].
    const { steps } = buildStepSnapshots(records, reader, undefined);
    // Verify.
    assert.ok(steps.length > 0);
    steps.forEach((step, i) => {
        assert.equal(step.index, i + 1);
        assert.ok(step.changeIds.length > 0);
    });
});

test("test_buildStepSnapshots_changedPaths_link_resolvable_steps_to_touched_files", () => {
    // Behavior: changedPaths is a best-effort changeId->path hint. Every resolved entry is one of the
    // document's touched files (never a stray path), and the join resolves at least one step (proving it
    // works) — but off-branch / re-stamped steps may resolve to [] since their changeId is not a surviving
    // revision's changeId.
    const branched = reconstructBranches(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    const touched = new Set(document.filesTouched.map((h: FileHistory) => h.target.toString()));
    let resolvedAny = false;
    // Verify: every changedPath entry is within filesTouched; entries are deduped; the join resolves ≥1 step.
    for (const step of document.steps) {
        assert.equal(step.changedPaths.length, new Set(step.changedPaths).size);
        for (const path of step.changedPaths) {
            assert.ok(touched.has(path));
        }
        if (step.changedPaths.length > 0) {
            resolvedAny = true;
        }
    }
    assert.ok(resolvedAny);
});

test("test_buildLineVerdicts_one_entry_per_record_in_file_order", () => {
    // Behavior: one entry per parsed record, line === array index.
    const verdicts = buildLineVerdicts(records);
    // Verify.
    assert.equal(verdicts.length, records.length);
    verdicts.forEach((v, i) => assert.equal(v.line, i));
});

test("test_buildLineVerdicts_classifies_each_line", () => {
    // Behavior: every entry's verdict is a Verdict member; a genuine prompt flips isGenuinePrompt.
    const verdicts = buildLineVerdicts(records);
    const verdictValues = new Set(Object.values(Verdict));
    // Verify: all verdicts valid; a genuine user prompt is flagged, a non-prompt user record is not.
    for (const v of verdicts) {
        assert.ok(verdictValues.has(v.verdict));
    }
    const genuineIndex = records.findIndex((r) => isGenuineUserPrompt(r));
    assert.equal(verdicts[genuineIndex]!.isGenuinePrompt, true);
    const nonPromptIndex = records.findIndex(
        (r) => r.type === RecordType.user && !isGenuineUserPrompt(r),
    );
    if (nonPromptIndex >= 0) {
        assert.equal(verdicts[nonPromptIndex]!.isGenuinePrompt, false);
    }
});

test("test_buildReconstructionDocument_step_count_matches_countStepsInTranscript", () => {
    // Behavior: the document's step count matches the engine's step counter.
    const branched = reconstructBranches(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    // Verify.
    assert.equal(document.steps.length, countStepsInTranscript(records, reader));
});

test("test_buildReconstructionDocument_includes_messages_branches_and_files", () => {
    // Behavior: messages, branches, filesTouched are all populated for S19.
    const branched = reconstructBranches(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    // Verify.
    assert.ok(document.messages.length > 0);
    assert.ok(document.branches.length > 0);
    assert.ok(document.filesTouched.length > 0);
});

test("test_buildReconstructionDocument_includes_line_verdicts_for_every_record", () => {
    // Behavior: lineVerdicts has one entry per parsed record.
    const branched = reconstructBranches(records, reader);
    const { document } = buildReconstructionDocument(records, branched, reader, undefined);
    // Verify.
    assert.equal(document.lineVerdicts.length, records.length);
});

// The task-119 skippedLines/failures document tests live in tests/reconstruction_json_health.test.ts
// (250-line cap split).

