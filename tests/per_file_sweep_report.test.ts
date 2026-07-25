// Task 186 (spec S11): the per-file sweep's pure half — candidate selection out of git's
// name-status output, the endpoint/gap verdict (endpoint matches are necessary but NOT
// sufficient), and a markdown table no note can break.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { SweepVerdict } from "../src/structures/vocabulary.ts";
import {
    classifySweepRow,
    formatSweepTable,
    selectCandidatesByStatus,
    type SweepRow,
} from "../src/per_file_sweep_report.ts";

const NAME_STATUS_FIXTURE = [
    "M\tcommon/scripts/plate/plate_cli.py",
    "M\ttests/conftest.py",
    "A\tscripts/fibonacci.py",
    "D\tskills/plate/SKILL.md",
    "R100\tskills/old/SKILL.md\tskills/new/SKILL.md",
    "",
].join("\n");

// A row with everything green; each test overrides just the field it is about.
function makeRow(overrides: Partial<SweepRow>): SweepRow {
    return {
        file: new Path("common/scripts/plate/plate_cli.py"),
        revisions: 34,
        baselineBlobMatched: true,
        diskMatched: true,
        unrecoverable: 0,
        seconds: 7,
        note: "",
        ...overrides,
    };
}

test("test_selectCandidatesByStatus_filters_by_status_letter", () => {
    // Scenario: each phase (M -> A -> D) asks for its own letter and gets only those paths.
    assert.deepEqual(
        selectCandidatesByStatus(NAME_STATUS_FIXTURE, "M").map((file) => file.toString()),
        ["common/scripts/plate/plate_cli.py", "tests/conftest.py"],
    );
    assert.deepEqual(
        selectCandidatesByStatus(NAME_STATUS_FIXTURE, "A").map((file) => file.toString()),
        ["scripts/fibonacci.py"],
    );
    assert.deepEqual(
        selectCandidatesByStatus(NAME_STATUS_FIXTURE, "D").map((file) => file.toString()),
        ["skills/plate/SKILL.md"],
    );
});

test("test_selectCandidatesByStatus_takes_the_destination_of_a_rename_line", () => {
    // Scenario: `R100\told\tnew` carries two paths — the candidate is the path that exists now.
    assert.deepEqual(
        selectCandidatesByStatus(NAME_STATUS_FIXTURE, "R").map((file) => file.toString()),
        ["skills/new/SKILL.md"],
    );
});

test("test_classifySweepRow_calls_a_complete_ladder_ok", () => {
    // Scenario: both endpoints match and nothing failed to replay.
    assert.equal(classifySweepRow(makeRow({})), SweepVerdict.ok);
});

test("test_classifySweepRow_calls_matched_endpoints_with_unrecoverable_revisions_gaps", () => {
    // Scenario: the S11 user correction — endpoint matches do NOT make a pass when the ladder
    // holds revisions the engine could not replay.
    assert.equal(classifySweepRow(makeRow({ unrecoverable: 3 })), SweepVerdict.gaps);
});

test("test_classifySweepRow_calls_either_missed_endpoint_an_endpoint_miss", () => {
    // Scenario: a wrong baseline blob or a final revision that is not today's disk content.
    assert.equal(classifySweepRow(makeRow({ baselineBlobMatched: false })), SweepVerdict.endpointMiss);
    assert.equal(classifySweepRow(makeRow({ diskMatched: false })), SweepVerdict.endpointMiss);
});

test("test_classifySweepRow_calls_an_empty_ladder_none", () => {
    // Scenario: no revisions at all — reported as its own verdict, never as an endpoint miss.
    assert.equal(
        classifySweepRow(makeRow({ revisions: 0, baselineBlobMatched: false, diskMatched: false })),
        SweepVerdict.none,
    );
});

test("test_formatSweepTable_emits_a_markdown_table_with_one_row_per_candidate", () => {
    // Scenario: header, alignment row, then the rows in order with the verdict column filled.
    const table = formatSweepTable([
        makeRow({}),
        makeRow({ file: new Path("tests/conftest.py"), revisions: 0, baselineBlobMatched: false, diskMatched: false }),
    ]);

    const lines = table.split("\n");
    assert.equal(lines.length, 4);
    assert.match(lines[0]!, /^\| file \| revisions \| baseline blob \| final = disk \| unrecoverable \| verdict \| seconds \| note \|$/);
    assert.match(lines[1]!, /^\| --- \|/);
    assert.match(lines[2]!, /plate_cli\.py.*\| 34 \| yes \| yes \| 0 \| ok \| 7 \|/);
    assert.match(lines[3]!, /conftest\.py.*\| 0 \| no \| no \| 0 \| none \| 7 \|/);
});

test("test_formatSweepTable_keeps_a_multiline_note_inside_its_cell", () => {
    // Scenario: an engine error message carrying newlines or pipes must not break the table —
    // every row stays exactly one line with the same column count.
    const table = formatSweepTable([makeRow({ note: "threw:\nhunk | mismatch\nat line 4" })]);

    const rowLine = table.split("\n")[2]!;
    assert.equal(rowLine.split("|").length, 10);
    assert.match(rowLine, /threw: hunk mismatch at line 4/);
});
