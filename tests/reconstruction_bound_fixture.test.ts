// task 193: the shared bound fixture builds the expected record counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBoundFixture } from "./reconstruction_bound_fixture.ts";

test("test_make_bound_fixture_adds_final_and_sidechain_prompts_on_request", () => {
  const base = makeBoundFixture({ withFinalPrompt: false, withSidechainPrompt: false });
  const withFinal = makeBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
  const withSidechain = makeBoundFixture({ withFinalPrompt: false, withSidechainPrompt: true });
  assert.equal(withFinal.records.length, base.records.length + 1);
  assert.equal(withSidechain.records.length, base.records.length + 1);
});
