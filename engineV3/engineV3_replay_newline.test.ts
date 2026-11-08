import { test } from "node:test";
import assert from "node:assert/strict";

import { decideFinalNewline, stripNewlineMarkerRows } from "./engineV3_replay_newline.ts";

const MARKER = "\\ No newline at end of file";

function makeHunk(lines: string[]) {
    return { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines };
}

test("test_stripNewlineMarkerRows_removes_marker_rows_and_keeps_the_input_hunk", () => {
    // Scenario: a hunk with a marker row gives a copy without it, and the input is unchanged.
    const hunk = makeHunk(["-X", "+Y", MARKER]);
    const stripped = stripNewlineMarkerRows([hunk]);
    // the copy has no marker, the input still has it
    assert.deepEqual(stripped[0]?.lines, ["-X", "+Y"]);
    assert.deepEqual(hunk.lines, ["-X", "+Y", MARKER]);
});

test("test_decideFinalNewline_keeps_the_start_value_when_there_is_no_marker", () => {
    // Scenario: no marker row, so the start value is returned.
    assert.equal(decideFinalNewline([makeHunk(["-X", "+Y"])], true), true);
    assert.equal(decideFinalNewline([makeHunk(["-X", "+Y"])], false), false);
});

test("test_decideFinalNewline_returns_false_when_a_marker_follows_a_context_row", () => {
    // Scenario: a marker after a context row means neither file ends with a newline.
    assert.equal(decideFinalNewline([makeHunk(["-X", "+Y", " Z", MARKER])], true), false);
});
