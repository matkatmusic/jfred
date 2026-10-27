// sendStaticFile: serves a webapp file with its content type and refuses a path that escapes webapp/.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { sendStaticFile } from "../src/viewer_server_static.ts";

function captureResponse(): { response: ServerResponse; status: () => number | undefined; headers: () => Record<string, string> } {
    let status: number | undefined;
    let headers: Record<string, string> = {};
    const response = {
        writeHead: (code: number, given: Record<string, string>) => {
            status = code;
            headers = given;
            return response;
        },
        end: () => undefined,
    } as unknown as ServerResponse;
    return { response, status: () => status, headers: () => headers };
}

test("test_send_static_file_serves_webapp_source_with_its_content_type", () => {
    const captured = captureResponse();
    sendStaticFile(captured.response, "/app/app-choices.ts");
    assert.equal(captured.status(), 200);
    assert.equal(captured.headers()["Content-Type"], "application/octet-stream");
});

test("test_send_static_file_throws_for_a_missing_file", () => {
    assert.throws(() => sendStaticFile(captureResponse().response, "/app/no-such-file.js"));
});
