// webapp/layer1-created-reason.ts: the wire spellings of the three reasons a created-at node is dropped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";

test("test_created_not_trusted_reason_values_are_the_member_names", () => {
  assert.deepEqual(Object.values(CreatedNotTrustedReason), ["noBirthTime", "birthNotBeforeMtime", "birthAfterFirstCommit"]);
  for (const [name, value] of Object.entries(CreatedNotTrustedReason)) {
    assert.equal(value, name);
  }
});
