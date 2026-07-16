import { test } from "node:test";
import assert from "node:assert/strict";
import {
    collectAcceptedUserEditIds,
    extractRenderableEvents,
} from "../src/reconstruction_renderable.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { loadRecords } from "./utilities.ts";
import { S13_JSONL, S15_JSONL } from "./fixtures.ts";

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

// extractRenderableEvents keeps the genuine S15 user edit as exactly one renderable turn.
test("test_extractRenderableEvents_keeps_the_genuine_S15_user_edit_turn", () => {
    // Filter the S15 transcript's events through its accepted set.
    const records = loadRecords(S15_JSONL);
    const accepted = collectAcceptedUserEditIds(records);
    const renderable = extractRenderableEvents(records, accepted);
    // Exactly one user-edit turn survives (the genuine content-changing edit).
    assert.equal(renderable.filter((event) => event.kind === EventKind.userEdit).length, 1);
});

