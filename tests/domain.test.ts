import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentId, Path, Uuid } from "../src/structures/domain.ts";

test("test_path_wraps_value_compares_and_serializes", () => {
    // Scenario: a Path wraps a path string, exposes its value, compares by value, and serializes to the raw string.
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
    // Scenario: a Uuid wraps any id string, even prefixed ids like toolu_, compares by value, and serializes raw.
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

test("test_agent_id_wraps_value_compares_and_serializes", () => {
    const agentId = new AgentId("a7b575676defea277");
    assert.equal(agentId.value, "a7b575676defea277");
    assert.equal(agentId.toString(), "a7b575676defea277");
    assert.ok(agentId.equals(new AgentId("a7b575676defea277")));
    assert.ok(!agentId.equals(new AgentId("other")));
    assert.equal(JSON.stringify(agentId), JSON.stringify("a7b575676defea277"));
});

