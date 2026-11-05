// Part P: POST /api/layer1-script-run guards, consent, stream lines, single flight, cancel, gate, Docker off.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as sendHttpRequest, type ClientRequest, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ReplayInput } from "../src/layer1_run_start_files.ts";
import { isImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { setSandboxMemoPersistence } from "../src/reconstruction_script_sandbox_memo.ts";
import { receiveScriptRun } from "../src/viewer_api_layer1_script_run.ts";
import { sendText } from "../src/viewer_server_routes.ts";
import { APPEND_Y_SCRIPT, APPEND_Z_SCRIPT, addScriptRun, addWrite, countSpawns, createCraftedProject, createCraftedSession, resetRunState, writeCraftedSession } from "./layer1_run_test_helpers.ts";

let server: Server;
let port: number;
const originalPath = process.env.PATH!;
const JSON_HEADERS = { "content-type": "application/json" };
const FAKE_DOCKER = '#!/bin/sh\necho "$1" >> "$FAKE_DOCKER_LOG"\n[ "$1" = kill ] && touch "$FAKE_DOCKER_LOG.killed"\nif [ "$1" = run ] && [ -n "$FAKE_DOCKER_HANG" ]; then\n  while [ ! -f "$FAKE_DOCKER_LOG.killed" ]; do sleep 0.1; done\nfi\nexit 0\n';

before(async () => {
    server = createServer((request, response) => {
        try {
            receiveScriptRun(request, response, new URL(request.url!, `http://127.0.0.1:${port}`));
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
    process.env.PATH = originalPath;
    setSandboxMemoPersistence(undefined);
});

function useFakeDocker(isHanging: boolean): string {
    const fakeDir = mkdtempSync(join(tmpdir(), "fake-docker-"));
    writeFileSync(join(fakeDir, "docker"), FAKE_DOCKER, { mode: 0o755 });
    process.env.PATH = `${fakeDir}:${originalPath}`;
    process.env.FAKE_DOCKER_HANG = isHanging ? "1" : "";
    process.env.FAKE_DOCKER_LOG = join(fakeDir, "log");
    return process.env.FAKE_DOCKER_LOG;
}

function startPost(input: ReplayInput, headers: Record<string, string>, body: object, onDone: (status: number, text: string) => void): ClientRequest {
    const query = new URLSearchParams({ dir: input.dir.toString(), repo: input.repoPath.toString(), jsonl: dirname(input.sessionFile.toString()) });
    const options = { host: "127.0.0.1", port, path: `/api/layer1-script-run?${query}`, method: "POST", headers };
    const request = sendHttpRequest(options, (response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => {
            text += chunk.toString();
        });
        response.on("end", () => onDone(response.statusCode ?? 0, text));
    });
    request.on("error", () => {});
    request.end(JSON.stringify(body));
    return request;
}

function postRun(input: ReplayInput, headers: Record<string, string>, body: object): Promise<{ status: number; text: string }> {
    return new Promise((resolve) => {
        startPost(input, headers, body, (status, text) => resolve({ status, text }));
    });
}

function buildBody(input: ReplayInput, allowScripts: boolean, toolUseId = "toolu_T"): object {
    return { sessionFile: input.sessionFile.toString(), toolUseId, allowScripts };
}

async function readLastLine(input: ReplayInput, toolUseId = "toolu_T"): Promise<Record<string, unknown>> {
    const reply = await postRun(input, JSON_HEADERS, buildBody(input, true, toolUseId));
    return JSON.parse(reply.text.trim().split("\n").at(-1)!);
}

async function waitForLogWord(logPath: string, word: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (existsSync(logPath) && readFileSync(logPath, "utf8").includes(word)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`docker never logged ${word}`);
}

function craftEarlierRunSession(): ReplayInput {
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    return writeCraftedSession(project, "toolu_T");
}

test("test_receiveScriptRun_rejects_a_wrong_content_type_a_wrong_host_and_an_unlisted_session_file_with_400", async () => {
    const { input } = createCraftedSession(APPEND_Z_SCRIPT);
    assert.equal((await postRun(input, { "content-type": "text/plain" }, {})).status, 400);
    assert.equal((await postRun(input, { ...JSON_HEADERS, host: "evil.example:80" }, {})).status, 400);
    assert.equal((await postRun(input, JSON_HEADERS, { ...buildBody(input, true), sessionFile: "/tmp/x.jsonl" })).status, 400);
});

test("test_receiveScriptRun_answers_consent_required_and_spawns_nothing_without_consent", async () => {
    resetRunState();
    const logPath = useFakeDocker(false);
    const { input } = createCraftedSession(APPEND_Z_SCRIPT);
    const reply = await postRun(input, JSON_HEADERS, buildBody(input, false));
    assert.equal(JSON.parse(reply.text).kind, "consent-required");
    assert.deepEqual([countSpawns(), existsSync(logPath)], [0, false]);
});

test("test_receiveScriptRun_streams_error_lines_for_an_unknown_run_and_an_unsaved_earlier_run", async () => {
    resetRunState();
    const gateBefore = isImpureExecutionAllowed();
    const { input } = createCraftedSession(APPEND_Z_SCRIPT);
    assert.match(String((await readLastLine(input, "toolu_missing")).label), /no script run/);
    assert.match(String((await readLastLine(craftEarlierRunSession())).label), /earlier script run is not saved/);
    assert.equal(isImpureExecutionAllowed(), gateBefore);
});

test("test_receiveScriptRun_streams_the_docker_off_error_and_starts_no_host_process", async () => {
    resetRunState();
    process.env.PATH = mkdtempSync(join(tmpdir(), "no-docker-"));
    const { input } = createCraftedSession(APPEND_Z_SCRIPT);
    const gateBefore = isImpureExecutionAllowed();
    const last = await readLastLine(input);
    process.env.PATH = originalPath;
    assert.match(String(last.label), /Docker is off or the image python:3\.14-slim is missing/);
    assert.equal(isImpureExecutionAllowed(), gateBefore);
});

test("test_receiveScriptRun_answers_409_for_a_second_live_run_then_a_close_kills_it_and_a_later_run_replays", async () => {
    resetRunState();
    const gateBefore = isImpureExecutionAllowed();
    const logPath = useFakeDocker(true);
    const { input } = createCraftedSession(APPEND_Z_SCRIPT);
    const firstRun = startPost(input, JSON_HEADERS, buildBody(input, true), () => {});
    await waitForLogWord(logPath, "run");
    assert.equal((await postRun(input, JSON_HEADERS, buildBody(input, true))).status, 409);
    firstRun.destroy();
    await waitForLogWord(logPath, "kill");
    process.env.FAKE_DOCKER_HANG = "";
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const last = await readLastLine(input);
    assert.deepEqual([last.kind, last.outcome], ["script-result", "replayed"]);
    assert.equal(isImpureExecutionAllowed(), gateBefore);
});
