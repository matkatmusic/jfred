// sendJson, sendText, getRequiredParam and the document/diff responses reject a missing project.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { getRequiredParam, sendDiffResponse, sendDocumentResponse, sendJson, sendText } from "../src/viewer_server_routes.ts";

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

test("test_send_json_writes_status_json_content_type_and_serialized_body", () => {
    const captured = captureResponse();
    sendJson(captured.response, 201, { a: 1 });
    assert.equal(captured.status(), 201);
    assert.equal(captured.headers()["Content-Type"], "application/json; charset=utf-8");
    assert.equal(captured.body(), '{"a":1}');
});

test("test_send_text_defaults_to_plain_text_content_type", () => {
    const captured = captureResponse();
    sendText(captured.response, 200, "hi");
    assert.equal(captured.headers()["Content-Type"], "text/plain; charset=utf-8");
    assert.equal(captured.body(), "hi");
});

test("test_get_required_param_returns_value_and_throws_when_missing", () => {
    assert.equal(getRequiredParam(new URLSearchParams("project=p"), "project"), "p");
    assert.throws(() => getRequiredParam(new URLSearchParams(), "project"), /missing query param: project/);
});

test("test_send_document_response_throws_without_project_before_any_header", () => {
    const captured = captureResponse();
    assert.throws(() => sendDocumentResponse(captured.response, new URLSearchParams()), /missing query param: project/);
    assert.equal(captured.status(), undefined);
});

test("test_send_diff_response_throws_without_project_before_any_header", () => {
    const captured = captureResponse();
    assert.throws(() => sendDiffResponse(captured.response, new URLSearchParams()), /missing query param: project/);
    assert.equal(captured.status(), undefined);
});
