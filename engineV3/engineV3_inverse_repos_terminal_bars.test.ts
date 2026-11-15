import { test } from "node:test";
import assert from "node:assert/strict";

import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { BAR_CELLS, FILE_NAME_WIDTH, buildBarText, buildFileLine, createTerminalBarsSink } from "./engineV3_inverse_repos_terminal_bars.ts";

test("test_not_started_file_gives_empty_bar", () => {
    // A file with fraction 0 gives a bar with no filled cells.
    const line = buildFileLine({ fileName: "a.ts", fraction: 0, countText: "" });
    assert.ok(line.includes(`[${"░".repeat(BAR_CELLS)}]`));
    assert.ok(!line.includes("█"));
});

test("test_done_file_gives_full_bar", () => {
    // A file with fraction 1 gives a bar with every cell filled.
    const line = buildFileLine({ fileName: "a.ts", fraction: 1, countText: "commits 2" });
    assert.ok(line.includes(`[${"█".repeat(BAR_CELLS)}]`));
    assert.ok(line.endsWith("commits 2"));
});

test("test_half_done_file_gives_half_bar", () => {
    // A file with fraction 0.5 gives a bar with half of the cells filled.
    const barText = buildBarText(0.5);
    assert.equal(barText, `[${"█".repeat(BAR_CELLS / 2)}${"░".repeat(BAR_CELLS / 2)}]`);
});

test("test_long_file_name_is_cut_to_fixed_width", () => {
    // A file name longer than the width is cut, so the bar starts in the same column for every file.
    const longLine = buildFileLine({ fileName: "src/".repeat(30) + "last.ts", fraction: 0, countText: "" });
    const shortLine = buildFileLine({ fileName: "a.ts", fraction: 0, countText: "" });
    assert.equal(longLine.indexOf("["), FILE_NAME_WIDTH + 1);
    assert.equal(shortLine.indexOf("["), FILE_NAME_WIDTH + 1);
    assert.ok(longLine.includes("last.ts"));
});

test("test_terminal_bar_of_a_half_done_file_is_half_full", () => {
    // With isTTY true, a step event with 1 of 2 steps done fills half of the cells of the bar of that file.
    const writes: string[] = [];
    const sink = createTerminalBarsSink({ isTTY: true, write: (text) => writes.push(text) }, ["a.ts", "b.ts"]);
    writes.length = 0;
    sink({ kind: DocumentResponseKind.progress, label: "b.ts", file: "b.ts", fileStepsDone: 1, fileStepsTotal: 2 });
    const halfBar = `[${"█".repeat(BAR_CELLS / 2)}${"░".repeat(BAR_CELLS / 2)}]`;
    const redrawnLines = writes.join("").split("\n");
    assert.ok(redrawnLines[0]!.includes("a.ts"));
    assert.ok(redrawnLines[0]!.includes(`[${"░".repeat(BAR_CELLS)}]`));
    assert.ok(redrawnLines[1]!.includes("b.ts"));
    assert.ok(redrawnLines[1]!.includes(halfBar));
});

test("test_non_terminal_writer_prints_nothing_for_step_events", () => {
    // With isTTY false, a step event writes no line.
    const writes: string[] = [];
    const sink = createTerminalBarsSink({ isTTY: false, write: (text) => writes.push(text) }, ["a.ts"]);
    sink({ kind: DocumentResponseKind.progress, label: "a.ts", file: "a.ts", fileStepsDone: 1, fileStepsTotal: 2 });
    assert.deepEqual(writes, []);
});

test("test_non_terminal_writer_prints_one_plain_line_per_finished_file", () => {
    // With isTTY false, each progress event gives one plain line and no escape codes are written.
    const writes: string[] = [];
    const sink = createTerminalBarsSink({ isTTY: false, write: (text) => writes.push(text) }, ["a.ts", "b.ts"]);
    sink({ kind: DocumentResponseKind.progress, label: "a.ts  events 1  commits 1  unknown 0", current: 1, total: 2 });
    sink({ kind: DocumentResponseKind.progress, label: "b.ts  events 2  commits 2  unknown 0", current: 2, total: 2 });
    assert.deepEqual(writes, ["1/2  a.ts  events 1  commits 1  unknown 0\n", "2/2  b.ts  events 2  commits 2  unknown 0\n"]);
    assert.ok(!writes.join("").includes("\x1b"));
});
