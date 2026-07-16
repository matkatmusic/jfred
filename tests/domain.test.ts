import { test } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";

test("test_path_wraps_value_compares_and_serializes", () => {
    // Scenario: a Path is a domain object around a filesystem path string, never
    // a bare primitive — it exposes its value, compares by value, and serializes
    // back to the raw string so the wire form round-trips.
    // Steps:
    // build a Path and read its value.
    const path = new Path("/tmp/run/s1_delete.py");
    assert.equal(path.value, "/tmp/run/s1_delete.py");
    assert.equal(path.toString(), "/tmp/run/s1_delete.py");
    // it compares by value, not identity.
    assert.ok(path.equals(new Path("/tmp/run/s1_delete.py")));
    assert.ok(!path.equals(new Path("/tmp/run/other.py")));
    // it serializes back to the raw path string.
    assert.equal(JSON.stringify(path), JSON.stringify("/tmp/run/s1_delete.py"));
});

test("test_uuid_wraps_any_id_value_compares_and_serializes", () => {
    // Scenario: a Uuid is a domain object around any identifier string — not only
    // RFC-4122 values, but also prefixed ids (toolu_…, cse_…) — so no id is ever
    // a bare primitive.
    // Steps:
    // build Uuids from both an RFC-4122 value and a prefixed tool-use id.
    const sessionId = new Uuid("b3634dc4-a385-40b9-8e23-6695a4f7bb7e");
    const toolId = new Uuid("toolu_01M2X7y2S89gKVE1eWq8kvPj");
    assert.equal(sessionId.value, "b3634dc4-a385-40b9-8e23-6695a4f7bb7e");
    assert.equal(toolId.toString(), "toolu_01M2X7y2S89gKVE1eWq8kvPj");
    // it compares by value, not identity.
    assert.ok(toolId.equals(new Uuid("toolu_01M2X7y2S89gKVE1eWq8kvPj")));
    assert.ok(!toolId.equals(sessionId));
    // it serializes back to the raw id string.
    assert.equal(JSON.stringify(toolId), JSON.stringify("toolu_01M2X7y2S89gKVE1eWq8kvPj"));
});

