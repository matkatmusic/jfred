import { test } from "node:test";
import assert from "node:assert/strict";
import {
    getModeEntry,
    getLastPromptEntry,
    getAttachmentEntry,
    getBridgeSessionEntry,
} from "../src/structures/session-meta.ts";
import { ATTACHMENT_PAYLOAD_TYPES } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { loadRecords } from "./utilities.ts";
import { S1_JSONL, S2_JSONL } from "./fixtures.ts";

test("test_mode_record_exposes_mode_value", () => {
    // Scenario: the `mode` record exposes its mode value ("normal" in s1).  Steps: find the first mode record in s1.
    const mode = loadRecords(S1_JSONL).map(getModeEntry).find(Boolean);
    if (!mode) {
        assert.fail("expected a mode record in s1");
    }
    // its mode value is the s1 ground-truth "normal".
    assert.equal(mode.mode, "normal");
    // its sessionId is a Uuid domain object, not a primitive.
    assert.ok(mode.sessionId instanceof Uuid);
});

test("test_bridge_session_record_exposes_uuid_ids", () => {
    // Scenario: a `bridge-session` record exposes both its sessionId and its (non-RFC-4122) bridgeSessionId as Uuid domain objects.  Steps: find the first bridge-session record in s1.
    const bridge = loadRecords(S1_JSONL).map(getBridgeSessionEntry).find(Boolean);
    if (!bridge) {
        assert.fail("expected a bridge-session record in s1");
    }
    // both ids are Uuid objects.
    assert.ok(bridge.sessionId instanceof Uuid);
    assert.ok(bridge.bridgeSessionId instanceof Uuid);
});

test("test_last_prompt_record_exposes_lastPrompt", () => {
    // Scenario: a `last-prompt` record that carries prompt text exposes a non-empty lastPrompt string (s1 has 3 such records plus 1 pointer-only).  Steps: find a last-prompt record whose lastPrompt text is populated.
    const entries = loadRecords(S1_JSONL).map(getLastPromptEntry).filter(Boolean);
    const withText = entries.find((entry) => entry?.lastPrompt !== undefined);
    if (!withText) {
        assert.fail("expected a last-prompt record carrying prompt text in s1");
    }
    // its lastPrompt is a non-empty string.
    assert.equal(typeof withText.lastPrompt, "string");
    assert.ok((withText.lastPrompt ?? "").length > 0);
    // its leafUuid pointer is a Uuid domain object.
    assert.ok(withText.leafUuid instanceof Uuid);
});

test("test_attachment_payload_type_is_within_s1_vocabulary", () => {
    // Scenario: every attachment record's payload `type` is one of the 6 attachment payload kinds observed in s1.  Steps: collect the attachment payload types present in s1.
    const allowed = new Set<string>(ATTACHMENT_PAYLOAD_TYPES);
    const s1Records = loadRecords(S1_JSONL);
    const attachmentEntries = s1Records.map(getAttachmentEntry);
    const attachments = attachmentEntries.filter(Boolean);
    // there are attachments in s1, and each payload type is recognized.
    assert.ok(attachments.length > 0);
    for (const attachment of attachments) {
        assert.ok(allowed.has(attachment!.attachment.type));
    }
    // the attachment's envelope domain fields are hydrated objects, not primitives.
    const first = attachments[0]!;
    assert.ok(first.uuid instanceof Uuid);
    assert.ok(first.sessionId instanceof Uuid);
    assert.ok(first.cwd instanceof Path);
    assert.ok(first.timestamp instanceof Date);
});

test("test_attachment_payload_type_covers_s2_kinds", () => {
    // Scenario: every s2 attachment payload `type` is recognized vocabulary — no kind in the transcript falls outside AttachmentPayloadType. (Which specific kinds occur is run-specific, so we assert coverage, not presence of any particular kind.)  Steps: collect the attachment payload types present in s2.
    const allowed = new Set<string>(ATTACHMENT_PAYLOAD_TYPES);
    const s2Records = loadRecords(S2_JSONL);
    const attachmentEntries = s2Records.map(getAttachmentEntry);
    const attachments = attachmentEntries.filter(Boolean);
    const attachmentTypes = attachments.map((attachment) => attachment!.attachment.type);
    const present = new Set(attachmentTypes);
    // there are attachments in s2, and every payload type is recognized vocabulary.
    assert.ok(present.size > 0);
    for (const type of present) {
        assert.ok(allowed.has(type), `unmodeled attachment kind: ${type}`);
    }
});

