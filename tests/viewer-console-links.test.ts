// Tests for the console's client-side line handling: the NDJSON splitter and the source tokens that jump to the timeline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchJsonlSourceLink } from "../webapp/app-console-text.ts";
import { splitNdjsonChunk } from "../webapp/app-ndjson.ts";
import { routeToTimeline } from "../webapp/app-routes.ts";

// -------------------- Step 4: client NDJSON line splitter --------------------

test("test_splitNdjsonChunk_reassembles_lines_across_chunk_boundaries", () => {
    // Scenario: a chunk ends mid-object; the splitter yields complete lines and carries the tail forward.
    const first = splitNdjsonChunk("", '{"a":1}\n{"b"');
    assert.deepEqual(first.lines, ['{"a":1}']);
    assert.equal(first.remainder, '{"b"');
    const second = splitNdjsonChunk(first.remainder, ':2}\n');
    assert.deepEqual(second.lines, ['{"b":2}']);
    assert.equal(second.remainder, "");
});

// -------------------- console [file:line] source tokens --------------------

test("test_matchJsonlSourceLink_extracts_file_and_zero_based_line", () => {
    // Scenario: a console line carries a "[<file>.jsonl:<line>]" source token with a 1-based transcript line number (formatRunSource's shape).
    const lineText = "12:00:00.000 executing script run @ 2026-07-05T12:00:00Z [foo.jsonl:123]";
    // Action: match the source token.
    const sourceLink = matchJsonlSourceLink(lineText);
    // Assertion: the file name, the 0-based line, and the token's position/text are extracted.
    assert.deepEqual(sourceLink, {
        jsonlFileName: "foo.jsonl",
        rawLineIndex: 122,
        tokenStartIndex: lineText.indexOf("["),
        tokenText: "[foo.jsonl:123]",
    });
});

test("test_matchJsonlSourceLink_returns_undefined_for_line_without_token", () => {
    // Scenario: an ordinary progress line with no source token.  Action: match against it.
    const sourceLink = matchJsonlSourceLink("12:00:00.000 parsing records");
    // Assertion: no link.
    assert.equal(sourceLink, undefined);
});

test("test_routeToTimeline_appends_line_anchor_after_session", () => {
    // Scenario: a token names session foo.jsonl, raw line 122; build the route with the anchor.
    const route = routeToTimeline("p", "foo.jsonl", "122");
    // Assertion: the /at/<line> segment follows the session segment.
    assert.equal(route, "#/project/p/timeline/session/foo.jsonl/at/122");
});

test("test_routeToTimeline_without_line_keeps_session_route", () => {
    // Scenario: a session anchor with no line anchor; build the route without a line.
    const route = routeToTimeline("p", "foo.jsonl");
    // Assertion: the route is the plain session route, unchanged.
    assert.equal(route, "#/project/p/timeline/session/foo.jsonl");
});
