// Test for src/viewer_api_layer1_fixture_routes.ts: the engineV3 steps route answers with the six fake steps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMITS } from "../src/viewer_api_layer1_fixture_data.ts";
import { FIXTURE_ROUTES } from "../src/viewer_api_layer1_fixture_routes.ts";
import { EngineV3StepKind } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";

test("test_the_engine_v3_steps_route_answers_with_the_commit_steps_and_six_session_steps", () => {
    // Steps: call the route handler with a recording response, parse the body, list the kinds.
    let body = "";
    const response = { writeHead: () => response, end: (text: string) => { body = text; } };
    const handleRoute = FIXTURE_ROUTES.get("/api/layer1-engine-v3-steps");
    assert.ok(handleRoute, "the route is not in the fixture route table");
    handleRoute({} as never, response as never, new URLSearchParams());
    const reply = JSON.parse(body) as { steps: { kind: string }[] };
    const kinds: string[] = [];
    for (const step of reply.steps) {
        kinds.push(step.kind);
    }
    assert.deepEqual([...new Set(kinds)].sort(), Object.values(EngineV3StepKind).sort());
    assert.equal(kinds.length, 6 + COMMITS.length);
});
