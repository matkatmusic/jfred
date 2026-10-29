// applyConfigUpdate: a body with neither folder is refused; a projects folder switch answers with the boot id.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { SERVER_BOOT_ID, applyConfigUpdate } from "../src/viewer_server_config.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

function captureResponse(): { response: ServerResponse; status: () => number | undefined; body: () => unknown } {
    let status: number | undefined;
    let body = "";
    const response = {
        writeHead: (code: number) => {
            status = code;
            return response;
        },
        end: (chunk: string) => {
            body = chunk;
        },
    } as unknown as ServerResponse;
    return { response, status: () => status, body: () => JSON.parse(body) };
}

test("test_apply_config_update_refuses_an_empty_body", () => {
    const captured = captureResponse();
    applyConfigUpdate(captured.response, "{}");
    assert.equal(captured.status(), 400);
});

test("test_apply_config_update_switches_projects_dir_and_reports_boot_id", () => {
    const captured = captureResponse();
    const projectsDir = createTempDir();
    applyConfigUpdate(captured.response, JSON.stringify({ projectsDir }));
    assert.equal(captured.status(), 200);
    const body = captured.body() as { projectsDir: string; bootId: string };
    assert.equal(body.bootId, SERVER_BOOT_ID);
    assert.match(body.projectsDir, /reveng-overrides-/);
});

test("test_apply_config_update_throws_on_a_bad_projects_dir", () => {
    assert.throws(() => applyConfigUpdate(captureResponse().response, JSON.stringify({ projectsDir: "/no/such/dir" })), /not a directory/);
});
