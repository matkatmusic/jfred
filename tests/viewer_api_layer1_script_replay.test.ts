// S2a: the Docker readiness reply and its route.

import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { DockerReadiness } from "../engineV3/engineV3_script_replay_container.ts";
import { buildDockerReadinessReply } from "../src/viewer_api_layer1_script_replay.ts";
import { dispatchLayer1Route } from "../src/viewer_server_layer1_routes.ts";
import { WireScriptReplayProblem } from "../webapp/layer1-wire-script-replay.ts";

test("test_docker_readiness_reply_is_empty_when_docker_is_ready", () => {
    // Docker is ready.
    const readiness = DockerReadiness.Ready;
    // The reply has no problem and no problem text.
    assert.deepEqual(buildDockerReadinessReply(readiness), {});
});

test("test_docker_readiness_reply_holds_the_problem_text_when_docker_is_missing", () => {
    // Docker is not installed: the reply names the problem and gives the exact text.
    assert.deepEqual(buildDockerReadinessReply(DockerReadiness.NotInstalled), {
        problem: WireScriptReplayProblem.dockerNotInstalled,
        problemText: "Docker is not installed. Install Docker, start it, then try again.",
    });
    // Docker is not running.
    assert.deepEqual(buildDockerReadinessReply(DockerReadiness.NotRunning), {
        problem: WireScriptReplayProblem.dockerNotRunning,
        problemText: "Docker is not running. Start Docker, then try again.",
    });
    // The script image is missing.
    assert.deepEqual(buildDockerReadinessReply(DockerReadiness.ImageMissing), {
        problem: WireScriptReplayProblem.imageMissing,
        problemText: 'The script image is missing. Run "npm run sandbox:build" in the jfred folder once, then try again.',
    });
});

test("test_docker_readiness_route_is_registered", () => {
    // A GET to the route is dispatched, and the dispatch says it owns the request.
    let body = "";
    const response = {
        writeHead: () => response,
        end: (chunk?: string) => {
            body += chunk ?? "";
        },
    } as unknown as ServerResponse;
    const request = { method: "GET", headers: {} } as unknown as IncomingMessage;
    const handled = dispatchLayer1Route(request, response, new URL("http://localhost/api/layer1-docker-readiness"));
    assert.equal(handled, true);
    // The reply is JSON that holds no field other than the two reply fields.
    const reply = JSON.parse(body) as Record<string, unknown>;
    for (const key of Object.keys(reply)) {
        assert.ok(key === "problem" || key === "problemText");
    }
});
