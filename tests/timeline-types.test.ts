// Unit tests for the timeline wire vocabulary constants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, EDIT_EVENT_KIND, USER_ROLE } from "../webapp/views/timeline-types.ts";

test("wire discriminants keep their string values", () => {
    assert.equal(COMMIT_NODE_KIND, "commit");
    assert.equal(AGENT_TURN_NODE_KIND, "agent-turn");
    assert.equal(EDIT_EVENT_KIND, "edit");
    assert.equal(USER_ROLE, "user");
});
