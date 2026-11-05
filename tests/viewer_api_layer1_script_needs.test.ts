// Part NS: POST /api/layer1-script-needs guards, reply shape, and saved results. No Docker, no allowScripts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as sendHttpRequest, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { dirname } from "node:path";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setSandboxMemoPersistence, storeSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";
import { Path } from "../src/structures/domain.ts";
import { receiveScriptNeeds } from "../src/viewer_api_layer1_script_needs.ts";
import { sendText } from "../src/viewer_server_routes.ts";
import {
    APPEND_Y_SCRIPT,
    APPEND_Z_SCRIPT,
    addScriptRun,
    addWrite,
    computeBoxedRunKey,
    createCraftedProject,
    resetRunState,
    writeCraftedSession,
} from "./layer1_run_test_helpers.ts";

let server: Server;
let port: number;

before(async () => {
    // Same 400 mapping as dispatchRequest in viewer_server.ts.
    server = createServer((request, response) => {
        try {
            receiveScriptNeeds(request, response, new URL(request.url!, `http://127.0.0.1:${port}`));
        }
        catch (error) {
            sendText(response, 400, String(error));
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
});

after(() => {
    server.close();
    setSandboxMemoPersistence(undefined);
});

function craftSession() {
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    return writeCraftedSession(project, "toolu_T");
}

function postNeeds(query: string, headers: Record<string, string>, body: object): Promise<{ status: number; text: string }> {
    return new Promise((resolve) => {
        const options = { host: "127.0.0.1", port, path: `/api/layer1-script-needs?${query}`, method: "POST", headers };
        const request = sendHttpRequest(options, (response) => {
            let text = "";
            response.on("data", (chunk: Buffer) => {
                text += chunk.toString();
            });
            response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
        });
        request.end(JSON.stringify(body));
    });
}

function buildQuery(input: { dir: Path; repoPath: Path; sessionFile: Path }): string {
    return new URLSearchParams({ dir: input.dir.toString(), repo: input.repoPath.toString(), jsonl: dirname(input.sessionFile.toString()) }).toString();
}

const JSON_HEADERS = { "content-type": "application/json" };

test("test_receiveScriptNeeds_rejects_a_wrong_content_type_with_400", async () => {
    const input = craftSession();
    const reply = await postNeeds(buildQuery(input), { "content-type": "text/plain" }, {});
    assert.equal(reply.status, 400);
});

test("test_receiveScriptNeeds_rejects_a_wrong_host_with_400", async () => {
    const input = craftSession();
    const reply = await postNeeds(buildQuery(input), { ...JSON_HEADERS, host: "evil.example:80" }, {});
    assert.equal(reply.status, 400);
});

test("test_receiveScriptNeeds_rejects_a_session_file_outside_the_sources_with_400", async () => {
    const input = craftSession();
    const body = { sessionFile: "/tmp/not-listed.jsonl", toolUseId: "toolu_T" };
    const reply = await postNeeds(buildQuery(input), JSON_HEADERS, body);
    assert.equal(reply.status, 400);
});

test("test_receiveScriptNeeds_answers_the_needs_reply_shape", async () => {
    resetRunState();
    const input = craftSession();
    const body = { sessionFile: input.sessionFile.toString(), toolUseId: "toolu_T" };
    const reply = await postNeeds(buildQuery(input), JSON_HEADERS, body);
    const parsed = JSON.parse(reply.text);
    assert.equal(reply.status, 200);
    assert.equal(parsed.toolUseId, "toolu_T");
    assert.deepEqual(parsed.needs.map((need: { toolUseId: string }) => need.toolUseId), ["toolu_A"]);
});

test("test_receiveScriptNeeds_answers_no_needs_when_the_earlier_result_is_saved", async () => {
    resetRunState();
    const input = craftSession();
    const earlierKey = computeBoxedRunKey(input, "toolu_A", new Map([["a.txt", "a\n"]]));
    storeSandboxOutcome(earlierKey, new Map([["a.txt", "a\nz\n"]]));
    const body = { sessionFile: input.sessionFile.toString(), toolUseId: "toolu_T" };
    const reply = await postNeeds(buildQuery(input), JSON_HEADERS, body);
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.text), { toolUseId: "toolu_T", needs: [] });
});

test("test_receiveScriptNeeds_reads_the_declared_sources_from_the_path_overrides", async () => {
    resetRunState();
    const input = craftSession();
    setPathOverrides({ sources: [{ projectsDir: new Path(dirname(input.sessionFile.toString())) }] });
    const body = { sessionFile: input.sessionFile.toString(), toolUseId: "toolu_T" };
    const reply = await postNeeds(buildQuery(input), JSON_HEADERS, body);
    setPathOverrides({});
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.text).needs.map((need: { toolUseId: string }) => need.toolUseId), ["toolu_A"]);
});

test("test_receiveScriptNeeds_answers_500_with_the_message_for_an_unknown_run", async () => {
    const input = craftSession();
    const body = { sessionFile: input.sessionFile.toString(), toolUseId: "toolu_missing" };
    const reply = await postNeeds(buildQuery(input), JSON_HEADERS, body);
    assert.equal(reply.status, 500);
    assert.match(reply.text, /no script run/);
});
