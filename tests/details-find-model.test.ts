// Details-pane find widget model (details-find-model.ts, task 127) — literal fixtures; one behavior per test. The DOM consumer (details-find.ts) walks #details-right-body's text nodes and feeds their values here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeMatchCounterLabel,
    computeWrappedMatchIndex,
    findMatchesInTextNodeValues,
} from "../webapp/views/details-find-model.ts";

test("test_findMatchesInTextNodeValues_blank_term_finds_nothing", () => {
    // Scenario: a blank find box is the idle state — no matches, no highlights.  Steps: "" and whitespace-only terms over a real value return no matches.
    assert.deepEqual(findMatchesInTextNodeValues(["def restock():"], ""), []);
    assert.deepEqual(findMatchesInTextNodeValues(["def restock():"], "  "), []);
});

test("test_findMatchesInTextNodeValues_matches_case_insensitively_with_offsets", () => {
    // Scenario: the term matches regardless of case, reporting which text node and the exact [start, end) span inside its value (the DOM side builds a Range from these).  Steps: "INVENTORY" over two values matches only the first, at offset 7..16.
    assert.deepEqual(
        findMatchesInTextNodeValues(["import inventory", "x = 1"], "INVENTORY"),
        [{ nodeIndex: 0, start: 7, end: 16 }],
    );
});

test("test_findMatchesInTextNodeValues_finds_every_occurrence_in_one_value", () => {
    // Scenario: a value containing the term twice yields two matches in order.  Steps: "in" over ["in in"] matches at 0 and 3.
    assert.deepEqual(
        findMatchesInTextNodeValues(["in in"], "in"),
        [{ nodeIndex: 0, start: 0, end: 2 }, { nodeIndex: 0, start: 3, end: 5 }],
    );
});

test("test_computeWrappedMatchIndex_wraps_both_directions", () => {
    // Scenario: next past the last match wraps to the first; prev before the first wraps to the last; no matches means no current index.  Steps: (2,3,+1)→0, (0,3,-1)→2, (0,0,+1)→-1.
    assert.equal(computeWrappedMatchIndex(2, 3, 1), 0);
    assert.equal(computeWrappedMatchIndex(0, 3, -1), 2);
    assert.equal(computeWrappedMatchIndex(0, 0, 1), -1);
});

test("test_computeMatchCounterLabel_formats_n_of_N", () => {
    // Scenario: the widget's counter shows 1-based "n/N" ("0/0" when nothing matches).  Steps: (-1,0)→"0/0", (2,7)→"3/7".
    assert.equal(computeMatchCounterLabel(-1, 0), "0/0");
    assert.equal(computeMatchCounterLabel(2, 7), "3/7");
});
