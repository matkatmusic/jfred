// Part X: POST /api/layer1-clear-results wipes the memo and caches and guards content type and Host.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request as sendHttpRequest, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path } from "../src/structures/domain.ts";
import { sendClearResultsResponse } from "../src/viewer_api_clear_results.ts";
import { sendText } from "../src/viewer_server_routes.ts";
import {
    getMemoizedSandboxOutcome,
    setSandboxMemoPersistence,
    storeSandboxOutcome,
    writePendingSandboxMemoToDisk,
} from "../src/reconstruction_script_sandbox_memo.ts";

let server: Server;
let port: number;

before(async () => {
    // Same 400 mapping as dispatchRequest in viewer_server.ts.
    server = createServer((request, response) => {
        try {
            sendClearResultsResponse(request, response);
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

function postClear(headers: Record<string, string>): Promise<number> {
    return new Promise((resolve) => {
        const request = sendHttpRequest({ host: "127.0.0.1", port, path: "/api/layer1-clear-results", method: "POST", headers }, (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
        });
        request.end("{}");
    });
}

test("test_clear_results_empties_the_memo_and_deletes_its_file", async () => {
    const memoFile = join(mkdtempSync(join(tmpdir(), "clear-results-")), "memo.json");
    setSandboxMemoPersistence(new Path(memoFile));
    storeSandboxOutcome("key-1", new Map([["a.txt", "x"]]));
    writePendingSandboxMemoToDisk();
    assert.ok(existsSync(memoFile));
    const status = await postClear({ "Content-Type": "application/json" });
    assert.equal(status, 200);
    assert.equal(getMemoizedSandboxOutcome("key-1"), undefined);
    assert.equal(existsSync(memoFile), false);
});

test("test_clear_results_with_a_wrong_content_type_is_a_400", async () => {
    const memoFile = join(mkdtempSync(join(tmpdir(), "clear-results-")), "memo.json");
    writeFileSync(memoFile, "{}");
    setSandboxMemoPersistence(new Path(memoFile));
    const status = await postClear({ "Content-Type": "text/plain" });
    assert.equal(status, 400);
    assert.ok(existsSync(memoFile));
});

test("test_clear_results_with_a_wrong_host_is_a_400", async () => {
    const status = await postClear({ "Content-Type": "application/json", Host: "evil.example:80" });
    assert.equal(status, 400);
});
