// GET /api/layer1-docker-readiness: tells the page whether recorded scripts can run in Docker.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { DockerReadiness, checkDockerReadiness } from "../engineV3/engineV3_script_replay_container.ts";
import { WireScriptReplayProblem, type WireDockerReadiness } from "../webapp/layer1-wire-script-replay.ts";
import { sendJson } from "./viewer_server_routes.ts";

export function buildDockerReadinessReply(readiness: DockerReadiness): WireDockerReadiness {
    if (readiness === DockerReadiness.NotInstalled) {
        return { problem: WireScriptReplayProblem.dockerNotInstalled, problemText: "Docker is not installed. Install Docker, start it, then try again." };
    }
    if (readiness === DockerReadiness.NotRunning) {
        return { problem: WireScriptReplayProblem.dockerNotRunning, problemText: "Docker is not running. Start Docker, then try again." };
    }
    if (readiness === DockerReadiness.ImageMissing) {
        return { problem: WireScriptReplayProblem.imageMissing, problemText: 'The script image is missing. Run "npm run sandbox:build" in the jfred folder once, then try again.' };
    }
    return {};
}

export function receiveDockerReadiness(request: IncomingMessage, response: ServerResponse, url: URL): void {
    const reply = buildDockerReadinessReply(checkDockerReadiness());
    sendJson(response, 200, reply);
}
