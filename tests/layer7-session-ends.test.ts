// Tests for scripts/visual/layer7-session-ends.ts: the first and last record of a fixture session.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findSessionEndIds } from "../scripts/visual/layer7-session-ends.ts";
import { FIXTURE_LOG_SESSIONS } from "../src/viewer_api_layer7_fixture_sessions.ts";

test("test_findSessionEndIds_gives_the_first_session_row_0_to_row_72", () => {
    // Step: the first session starts at ruler row 0 and ends at row 72.
    assert.deepEqual(findSessionEndIds(FIXTURE_LOG_SESSIONS[0]!.id), { firstId: "l7-row-000", lastId: "l7-row-072" });
});

test("test_findSessionEndIds_gives_a_later_session_its_own_first_record", () => {
    // Step: the fourth session starts at filler 30.
    assert.equal(findSessionEndIds(FIXTURE_LOG_SESSIONS[3]!.id).firstId, "l7-fill-30");
});
