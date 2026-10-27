// Tests for src/viewer_api_repo_paths.ts: the project paths GET param check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { dispatchProjectPathsRequest } from "../src/viewer_api_repo_paths.ts";

test("test_dispatchProjectPathsRequest_throws_without_a_project_on_get", () => {
    // Behavior: a GET without the project param throws a missing-param error.  Steps: a GET request stub and an empty query.
    const request = { method: "GET" } as IncomingMessage;
    assert.throws(() => dispatchProjectPathsRequest(request, {} as ServerResponse, new URLSearchParams()), /missing query param: project/);
});
