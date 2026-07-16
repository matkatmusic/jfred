// Tests for the hash-route predicates in webapp/app.js. Segments arrive exactly as
// parseRouteSegments produces them: decoded, empty segments dropped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRouteIsTimeline } from "../webapp/app-routes.ts";
import { checkNavigationStartsNewProjectLoad } from "../webapp/app-router.ts";

test("test_check_route_is_timeline_accepts_every_project_route", () => {
    // Scenario: the timeline is ALWAYS a loaded project's base view (user decision 2026-07-06) —
    // every #/project/* route gets the overlay-inspector layout, jsonl and file sub-routes
    // included (they render as drawers over the timeline).
    assert.equal(checkRouteIsTimeline(["project", "s84", "timeline"]), true);
    assert.equal(checkRouteIsTimeline(["project", "s84", "timeline", "session", "abc"]), true);
    assert.equal(checkRouteIsTimeline(["project", "s84"]), true);
    assert.equal(checkRouteIsTimeline(["project", "s84", "jsonl", "a.jsonl"]), true);
    assert.equal(checkRouteIsTimeline(["project", "s84", "file", "x.ts"]), true);
});

test("test_check_route_is_timeline_rejects_non_project_routes", () => {
    // Scenario: the projects list and unknown routes carry no timeline underneath.
    assert.equal(checkRouteIsTimeline([]), false);
    assert.equal(checkRouteIsTimeline(["bogus"]), false);
});

test("test_check_navigation_starts_new_project_load_on_project_change", () => {
    // Scenario: the console holds project A's load output; navigating to project B starts a
    // new load, so the console must clear (TASKS item 22).
    assert.equal(checkNavigationStartsNewProjectLoad("project-a", "project-b"), true);
});

test("test_check_navigation_starts_new_project_load_on_first_project_load", () => {
    // Scenario: before any project load the console holds only landing-page output; the
    // first project load clears it so the console shows exactly that load.
    assert.equal(checkNavigationStartsNewProjectLoad(undefined, "project-a"), true);
});

test("test_check_navigation_keeps_console_within_one_project", () => {
    // Scenario: sub-route hops (timeline → file → jsonl) inside one project belong to the
    // same load story — never clear.
    assert.equal(checkNavigationStartsNewProjectLoad("project-a", "project-a"), false);
});

test("test_check_navigation_keeps_console_on_non_project_routes", () => {
    // Scenario: the projects list loads no project — leaving A's output visible is correct.
    assert.equal(checkNavigationStartsNewProjectLoad("project-a", undefined), false);
    assert.equal(checkNavigationStartsNewProjectLoad(undefined, undefined), false);
});

