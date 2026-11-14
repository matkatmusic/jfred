// Per-file test for webapp/layer1-wire-script-replay.ts: the wire constants have the contract's spellings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireScriptReplayProblem, WireScriptReplayReason } from "../webapp/layer1-wire-script-replay.ts";

test("test_wire_constants_have_the_values_of_the_contract", () => {
    // Verify: the problem constant spells docker-not-installed, docker-not-running and image-missing.
    assert.deepEqual(WireScriptReplayProblem, {
        dockerNotInstalled: "docker-not-installed",
        dockerNotRunning: "docker-not-running",
        imageMissing: "image-missing",
    });
    // Verify: the reason constant spells named-by-file and birth-candidate.
    assert.deepEqual(WireScriptReplayReason, {
        namedByFile: "named-by-file",
        birthCandidate: "birth-candidate",
    });
});
