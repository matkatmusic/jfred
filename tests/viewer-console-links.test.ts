// Tests for the viewer console's client-side line handling: the NDJSON chunk splitter (Step 4)
// and the "[<file>.jsonl:<line>]" source tokens that turn console lines into timeline jumps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchJsonlSourceLink } from "../webapp/app-console.ts";
import { splitNdjsonChunk } from "../webapp/app-ndjson.ts";
import { routeToTimeline } from "../webapp/app-routes.ts";

// -------------------- Step 4: client NDJSON line splitter --------------------

test("test_splitNdjsonChunk_reassembles_lines_across_chunk_boundaries", () => {
    // Scenario: NDJSON arrives in arbitrary chunks; a JSON object may be split across a chunk
    // boundary. The splitter yields only complete lines and carries the partial tail forward.
    // Steps: feed a chunk that ends mid-object, then the chunk that completes it.
    const first = splitNdjsonChunk("", '{"a":1}\n{"b"');
    assert.deepEqual(first.lines, ['{"a":1}']);
    assert.equal(first.remainder, '{"b"');
    const second = splitNdjsonChunk(first.remainder, ':2}\n');
    assert.deepEqual(second.lines, ['{"b":2}']);
    assert.equal(second.remainder, "");
});

// -------------------- console [file:line] source tokens --------------------

test("test_matchJsonlSourceLink_extracts_file_and_zero_based_line", () => {
    // Scenario: a console line carries a "[<file>.jsonl:<line>]" source token with a 1-based
    // transcript line number (formatRunSource's shape).
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
    // Scenario: an ordinary progress line with no source token.
    // Action: match against it.
    const sourceLink = matchJsonlSourceLink("12:00:00.000 parsing records");
    // Assertion: no link.
    assert.equal(sourceLink, undefined);
});

test("test_routeToTimeline_appends_line_anchor_after_session", () => {
    // Scenario: a console token names session foo.jsonl, raw line 122 (0-based).
    // Action: build the timeline route with the line anchor.
    const route = routeToTimeline("p", "foo.jsonl", "122");
    // Assertion: the /at/<line> segment follows the session segment.
    assert.equal(route, "#/project/p/timeline/session/foo.jsonl/at/122");
});

test("test_routeToTimeline_without_line_keeps_session_route", () => {
    // Scenario: a session anchor with no line anchor (the drawer's existing links).
    // Action: build the timeline route without a line.
    const route = routeToTimeline("p", "foo.jsonl");
    // Assertion: the route is the plain session route, unchanged.
    assert.equal(route, "#/project/p/timeline/session/foo.jsonl");
});
