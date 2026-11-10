// The engineV3 mockup names exactly six step kinds, spelled the way the route sends them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineV3StepKind } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";

test("test_engine_v3_step_kinds_are_the_seven_named_kinds", () => {
    // Steps: list the values, compare with the seven spellings.
    assert.deepEqual(Object.values(EngineV3StepKind), ["commit", "edit", "script", "snapshot", "rewind-code", "rewind-chat-only", "no-file-change"]);
});
