// sendRangePatchResponse and sendStepFilesResponse reject a request with no project.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { sendRangePatchResponse, sendStepFilesResponse } from "../src/viewer_server_range_routes.ts";

function captureStatus(): { response: ServerResponse; status: () => number | undefined } {
    let status: number | undefined;
    const response = {
        writeHead: (code: number) => {
            status = code;
            return response;
        },
        end: () => undefined,
    } as unknown as ServerResponse;
    return { response, status: () => status };
}

test("test_send_range_patch_response_throws_without_project_before_any_header", () => {
    const captured = captureStatus();
    assert.throws(() => sendRangePatchResponse(captured.response, new URLSearchParams()), /missing query param: project/);
    assert.equal(captured.status(), undefined);
});

test("test_send_step_files_response_throws_without_project_before_any_header", () => {
    const captured = captureStatus();
    assert.throws(() => sendStepFilesResponse(captured.response, new URLSearchParams()), /missing query param: project/);
    assert.equal(captured.status(), undefined);
});
