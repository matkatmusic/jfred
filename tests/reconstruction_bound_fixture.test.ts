// task 193: the shared bound fixture builds the expected record counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundFixture } from "./reconstruction_bound_fixture.ts";

test("test_make_bound_fixture_adds_final_and_sidechain_prompts_on_request", () => {
  const base = createBoundFixture({ withFinalPrompt: false, withSidechainPrompt: false });
  const withFinal = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
  const withSidechain = createBoundFixture({ withFinalPrompt: false, withSidechainPrompt: true });
  assert.equal(withFinal.records.length, base.records.length + 1);
  assert.equal(withSidechain.records.length, base.records.length + 1);
});
