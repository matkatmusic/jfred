// Tests for the route builders and the hash parser in webapp/app-routes.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import {
    getConversationRoute,
    getFileHistoryRoute,
    getProjectRoute,
    getTimelineRoute,
    parseRouteSegments,
} from "../webapp/app-routes.ts";

test("test_route_builders_encode_each_segment", () => {
    // Scenario: every user-supplied part is URI-encoded inside the route.  assert the project, file-history, and conversation routes.
    assert.equal(getProjectRoute("a b"), "#/project/a%20b");
    assert.equal(getFileHistoryRoute("p", "/x/y.ts"), "#/project/p/file/%2Fx%2Fy.ts");
    assert.equal(getConversationRoute("p", "s.jsonl"), "#/project/p/jsonl/s.jsonl");
    assert.equal(getConversationRoute("p", "s.jsonl", 4), "#/project/p/jsonl/s.jsonl/at/4");
});

test("test_getTimelineRoute_adds_session_then_line_anchor", () => {
    // Scenario: the timeline route grows a session part, then a line part.  assert the three shapes.
    assert.equal(getTimelineRoute("p"), "#/project/p/timeline");
    assert.equal(getTimelineRoute("p", "s.jsonl"), "#/project/p/timeline/session/s.jsonl");
    assert.equal(getTimelineRoute("p", "s.jsonl", "9"), "#/project/p/timeline/session/s.jsonl/at/9");
});

test("test_parseRouteSegments_decodes_and_drops_empty_segments", () => {
    // Scenario: the hash splits on slashes, drops empty parts, and decodes each part.
    initWebappDom();
    location.hash = "#/project/a%20b//file/x";
    // assert the decoded segments.
    assert.deepEqual(parseRouteSegments(), ["project", "a b", "file", "x"]);
});
