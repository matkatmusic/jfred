import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAncestorUuids } from "../src/reconstruction_tree.ts";
import { Uuid } from "../src/structures/domain.ts";
import {
    buildAssistantRecord,
    buildAttachmentRecord,
    buildUserTextRecord,
} from "./record_builders.ts";

// The ancestor walk includes the tip and stops at an unresolvable parent.
test("test_collectAncestorUuids_walks_from_tip_to_unresolvable_parent", () => {
    const prompt = buildUserTextRecord("p1", "fork", "Edit …", "2026-01-01T00:00:10Z");
    const attachment = buildAttachmentRecord("att1", "p1", "2026-01-01T00:00:11Z");
    const assistant = buildAssistantRecord("as1", "att1", "Edited.", "2026-01-01T00:00:12Z");
    const ancestors = collectAncestorUuids([prompt, attachment, assistant], new Uuid("as1"));
    assert.deepEqual([...ancestors].sort(), ["as1", "att1", "p1"]);
});
