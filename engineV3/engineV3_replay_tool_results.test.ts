import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import type { JSONLLine } from "./engineV3.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { applyJSONLLineToState } from "./engineV3_replay_apply.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-tool-results-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeSecond(secondsPastMidnight: number): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
}

function makeCallRecord(toolUseIds: string[], secondsPastMidnight: number): object {
    const content = toolUseIds.map((id) => ({ type: "tool_use", id, name: "Write", input: {}, caller: { type: "direct" } }));
    return { type: "assistant", uuid: `a-${toolUseIds.join("-")}`, timestamp: makeSecond(secondsPastMidnight), message: { role: "assistant", content } };
}

function makeResultRecord(toolUseId: string, filePath: string, text: string, secondsPastMidnight: number): object {
    const toolUseResult = { type: "create", filePath, content: text, structuredPatch: [], originalFile: null, userModified: false };
    const content = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    return { type: "user", uuid: `r-${toolUseId}`, timestamp: makeSecond(secondsPastMidnight), message: { role: "user", content }, toolUseResult };
}

function loadRecords(t: TestContext, records: object[]): JSONLLine[] {
    const jsonlFolder = makeTempFolder(t);
    writeFileSync(join(jsonlFolder, "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return loadMergedJSONLLines([jsonlFolder]).jsonlLines;
}

function makeContext(lines: JSONLLine[]): ScriptReplayContext {
    return { bashCallResults: new Map(), writeEditResultLines: collectWriteEditResultLines(lines), sourceRepo: new Path("/nonexistent") };
}

test("test_collectWriteEditResultLines_pairs_a_call_with_its_result_line", (t) => {
    // Scenario: a Write call line and its later result line are paired by tool_use id.
    const stateFolder = makeTempFolder(t);
    const lines = loadRecords(t, [makeCallRecord(["toolu_A"], 1), makeResultRecord("toolu_A", join(stateFolder, "a.txt"), "one", 2)]);
    // collect the pairs
    const resultLines = collectWriteEditResultLines(lines);
    // the map holds one entry whose value is the result line
    assert.deepEqual([...resultLines.keys()], ["toolu_A"]);
    assert.equal(resultLines.get("toolu_A"), lines[1]);
});

test("test_collectWriteEditResultLines_leaves_out_a_call_with_no_result_line_and_a_result_with_no_call_line", (t) => {
    // Scenario: toolu_A has only a call line and toolu_B has only a result line.
    const stateFolder = makeTempFolder(t);
    const lines = loadRecords(t, [makeCallRecord(["toolu_A"], 1), makeResultRecord("toolu_B", join(stateFolder, "b.txt"), "two", 2)]);
    // neither id is paired
    assert.equal(collectWriteEditResultLines(lines).size, 0);
});

test("test_applyJSONLLineToState_applies_a_Write_at_the_call_line", (t) => {
    // Scenario: applying the call line writes the file before the result line is reached.
    const stateFolder = makeTempFolder(t);
    const lines = loadRecords(t, [makeCallRecord(["toolu_A"], 1), makeResultRecord("toolu_A", join(stateFolder, "a.txt"), "one", 2)]);
    // apply only the call line
    applyJSONLLineToState(new Path(stateFolder), lines[0]!, [], makeContext(lines));
    // the file has the result's content
    assert.equal(readFileSync(join(stateFolder, "a.txt"), "utf8"), "one");
});

test("test_applyJSONLLineToState_does_nothing_at_the_result_line_of_an_applied_call", (t) => {
    // Scenario: the result line of an already applied call must not write again.
    const stateFolder = makeTempFolder(t);
    const filePath = join(stateFolder, "a.txt");
    const lines = loadRecords(t, [makeCallRecord(["toolu_A"], 1), makeResultRecord("toolu_A", filePath, "one", 2)]);
    const context = makeContext(lines);
    applyJSONLLineToState(new Path(stateFolder), lines[0]!, [], context);
    // a later change to the file stays after the result line is applied
    writeFileSync(filePath, "changed later");
    applyJSONLLineToState(new Path(stateFolder), lines[1]!, [], context);
    assert.equal(readFileSync(filePath, "utf8"), "changed later");
});

test("test_applyJSONLLineToState_applies_a_result_with_no_call_line_at_the_result_line", (t) => {
    // Scenario: no call line exists, so the result line writes the file as before.
    const stateFolder = makeTempFolder(t);
    const lines = loadRecords(t, [makeResultRecord("toolu_B", join(stateFolder, "b.txt"), "two", 2)]);
    // apply the result line
    applyJSONLLineToState(new Path(stateFolder), lines[0]!, [], makeContext(lines));
    // the file has the result's content
    assert.equal(readFileSync(join(stateFolder, "b.txt"), "utf8"), "two");
});

test("test_applyJSONLLineToState_applies_two_Write_blocks_of_one_line_in_order", (t) => {
    // Scenario: one call line holds two Writes to the same file, so the second content wins.
    const stateFolder = makeTempFolder(t);
    const filePath = join(stateFolder, "a.txt");
    const lines = loadRecords(t, [makeCallRecord(["toolu_A", "toolu_B"], 1), makeResultRecord("toolu_A", filePath, "first", 2), makeResultRecord("toolu_B", filePath, "second", 3)]);
    // apply the call line
    applyJSONLLineToState(new Path(stateFolder), lines[0]!, [], makeContext(lines));
    // the file has the second content
    assert.equal(readFileSync(filePath, "utf8"), "second");
});
