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

test("test_fixture_mode_answers_the_inverse_repos_history_with_a_result_line", () => {
    // Steps: call the route the way the page does (progress=1) with a recording response.
    let statusCode = 0;
    let body = "";
    const response = {
        writeHead: (status: number) => { statusCode = status; return response; },
        end: (text: string) => { body = text; },
    };
    const handleRoute = FIXTURE_ROUTES.get("/api/layer1-inverse-repos");
    assert.ok(handleRoute, "the route is not in the fixture route table");
    handleRoute({} as never, response as never, new URLSearchParams("dir=/fixture/demo/worktree&progress=1"));
    // The reply is 200 and its last NDJSON line is the result: a files list, not a progress or error line.
    assert.equal(statusCode, 200);
    const lines = body.trim().split("\n");
    const resultLine = JSON.parse(lines[lines.length - 1]!) as { kind?: string; files: { file: string; commits: unknown[] }[] };
    assert.equal(resultLine.kind, undefined);
    assert.ok(resultLine.files.length > 0, "the result lists no files");
    // Every listed file has at least one commit.
    for (const file of resultLine.files) {
        assert.ok(file.commits.length > 0, `${file.file} has no commits`);
    }
});
