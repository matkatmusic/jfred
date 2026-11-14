// sendStaticFile: serves a webapp file with its content type and refuses a path that escapes webapp/.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { sendStaticFile } from "../src/viewer_server_static.ts";

function captureResponse(): { response: ServerResponse; status: () => number | undefined; headers: () => Record<string, string>; body: () => string } {
    let status: number | undefined;
    let headers: Record<string, string> = {};
    let body = "";
    const response = {
        writeHead: (code: number, given: Record<string, string>) => {
            status = code;
            headers = given;
            return response;
        },
        end: (text: string) => {
            body = text;
        },
    } as unknown as ServerResponse;
    return { response, status: () => status, headers: () => headers, body: () => body };
}

test("test_send_static_file_serves_webapp_source_with_its_content_type", () => {
    const captured = captureResponse();
    sendStaticFile(captured.response, "/app/app-choices.ts");
    assert.equal(captured.status(), 200);
    assert.equal(captured.headers()["Content-Type"], "application/octet-stream");
});

test("test_send_static_file_serves_the_layer1_page_for_the_root_address", () => {
    // Scenario: a request for "/" returns layer1.html, which alone holds the appWindow element.
    const captured = captureResponse();
    sendStaticFile(captured.response, "/");
    assert.equal(captured.status(), 200);
    assert.ok(captured.body().includes('id="appWindow"'));
});

test("test_send_static_file_still_serves_the_old_default_page_as_index_html", () => {
    // Scenario: a request for "/index.html" returns the layered page, which alone holds the layered-drawer-toggle button.
    const captured = captureResponse();
    sendStaticFile(captured.response, "/index.html");
    assert.equal(captured.status(), 200);
    assert.ok(captured.body().includes('id="layered-drawer-toggle"'));
});

test("test_send_static_file_throws_for_a_missing_file", () => {
    assert.throws(() => sendStaticFile(captureResponse().response, "/app/no-such-file.js"));
});
