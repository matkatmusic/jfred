import { test } from "node:test";
import assert from "node:assert/strict";
import {
    collectDescendantUuids,
    findDeepestPromptOrReply,
} from "../src/reconstruction_descendants.ts";
import { Uuid } from "../src/structures/domain.ts";
import { loadRecords } from "./utilities.ts";
import { S13_JSONL } from "./fixtures.ts";
import {
    buildAssistantRecord,
    buildAttachmentRecord,
    buildUserTextRecord,
} from "./record_builders.ts";

// The descendant walk must follow every child type, or a continuation past an attachment is missed.
test("test_collectDescendantUuids_walks_through_attachment_intermediaries", () => {
    const prompt = buildUserTextRecord("p1", "fork", "Edit …", "2026-01-01T00:00:10Z");
    const attachment = buildAttachmentRecord("att1", "p1", "2026-01-01T00:00:11Z");
    const assistant = buildAssistantRecord("as1", "att1", "Edited.", "2026-01-01T00:00:12Z");
    const descendants = collectDescendantUuids([prompt, attachment, assistant], new Uuid("p1"));
    assert.equal(descendants.has("as1"), true);
});

// The tip is the deepest user or assistant turn, never a trailing system record.
test("test_findDeepestPromptOrReply_returns_the_last_assistant_not_a_trailing_system_record", () => {
    const records = loadRecords(S13_JSONL);
    const abandonedPrompt = records.find(
        (record) => record.uuid !== undefined && record.uuid.toString().startsWith("7ceda07f"),
    )!;
    const tip = findDeepestPromptOrReply(records, abandonedPrompt.uuid!);
    assert.ok(tip !== undefined);
    assert.equal(tip!.toString().slice(0, 8), "1623ed02");
});
