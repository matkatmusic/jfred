import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { getContentBlocks } from "../src/structures/content-blocks.ts";
import { BlockType } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";
import { getFirstLineTime, loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { loadJSONLLineIndex, readFullJSONLLine, readFullResultLines } from "./engineV3_jsonl_line_index.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectResultTurnSnapshotIds, collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import { collectEarlierSiblingMessageIds, collectForkedMessageIds } from "./engineV3_replay_backups.ts";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-line-index-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeTime(secondsPastMidnight: number): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + secondsPastMidnight * 1000).toISOString();
}

function makeAssistantToolUseLine(uuid: string, parentUuid: string | null, seconds: number, toolUseId: string, toolName: string, input: object): string {
    return JSON.stringify({ type: "assistant", uuid, parentUuid, sessionId: "sA", timestamp: makeTime(seconds), message: { role: "assistant", content: [{ type: "text", text: "doing it ✓" }, { type: "tool_use", id: toolUseId, name: toolName, input }] } });
}

function makeToolResultLine(uuid: string, parentUuid: string, seconds: number, toolUseId: string, resultText: string): string {
    return JSON.stringify({ type: "user", uuid, parentUuid, sessionId: "sA", timestamp: makeTime(seconds), message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: resultText, is_error: false }] } });
}

function makeUserTextLine(uuid: string, parentUuid: string | null, sessionId: string, seconds: number, text: string): string {
    return JSON.stringify({ type: "user", uuid, parentUuid, sessionId, timestamp: makeTime(seconds), message: { role: "user", content: text } });
}

// Two files that use every sort rule: a Bash call whose result came 3 minutes later, a snapshot line with no
// timestamp, a line with no timestamp, a same-second tie across files, an unknown record type, a blank line,
// non-ASCII text (so byte offsets differ from character offsets), a Write call with its result, and a fork.
function writeSortRulesFixture(folder: string): void {
    const fileALines = [
        makeUserTextLine("a1", null, "sA", 10, "héllo wörld ✓"),
        makeAssistantToolUseLine("a2", "a1", 20, "toolu_b1", "Bash", { command: "echo ✓" }),
        "",
        makeToolResultLine("a3", "a2", 200, "toolu_b1", "out ✓"),
        makeAssistantToolUseLine("a4", "a3", 210, "toolu_w1", "Write", { file_path: "/tmp/x.txt", content: "new text ✓" }),
        makeToolResultLine("a5", "a4", 211, "toolu_w1", "File created successfully at: /tmp/x.txt"),
        JSON.stringify({ type: "file-history-snapshot", messageId: "a4", snapshot: { messageId: "a4", timestamp: makeTime(215), trackedFileBackups: {} }, isSnapshotUpdate: false }),
        JSON.stringify({ type: "x-new-kind", uuid: "a6", sessionId: "sA", timestamp: makeTime(220), payload: "ünknown" }),
    ];
    const fileBLines = [
        makeUserTextLine("b1", null, "sB", 20, "same second"),
        makeUserTextLine("b2", "b1", "sB", 100, "first child"),
        makeUserTextLine("b3", "b1", "sB", 101, "second child, a fork"),
        JSON.stringify({ type: "last-prompt", leafUuid: "b3", sessionId: "sB" }),
    ];
    writeFileSync(join(folder, "sA.jsonl"), fileALines.join("\n") + "\n");
    writeFileSync(join(folder, "sB.jsonl"), fileBLines.join("\n") + "\n");
}

function listFileAndLineNumbers(lines: JSONLLine[]): string[] {
    const fileAndLineNumbers: string[] = [];
    for (const line of lines) {
        const source = getRecordSource(line);
        fileAndLineNumbers.push(`${source?.filePath}:${source?.lineNumber}`);
    }
    return fileAndLineNumbers;
}

test("test_loadJSONLLineIndex_orders_the_lines_like_loadMergedJSONLLines", (t) => {
    // Scenario: the index gives the same sequence of (file, line number) pairs as the full loader, for every sort rule.
    const folder = makeTempFolder(t);
    writeSortRulesFixture(folder);
    const fullLines = loadMergedJSONLLines([folder]).jsonlLines;
    const indexLines = loadJSONLLineIndex([folder]).indexLines;
    assert.equal(fullLines.length, 11);
    assert.deepEqual(listFileAndLineNumbers(indexLines), listFileAndLineNumbers(fullLines));
});

test("test_readFullJSONLLine_reads_the_same_line_as_loadMergedJSONLLines", (t) => {
    // Scenario: each index line, read again from disk, deep-equals the line the full loader holds at the same place.
    const folder = makeTempFolder(t);
    writeSortRulesFixture(folder);
    const fullLines = loadMergedJSONLLines([folder]).jsonlLines;
    const indexLines = loadJSONLLineIndex([folder]).indexLines;
    for (const [lineIndex, indexLine] of indexLines.entries()) {
        const fullLine = readFullJSONLLine(indexLine);
        assert.deepEqual(fullLine, fullLines[lineIndex]);
        assert.deepEqual(getRecordSource(fullLine), getRecordSource(fullLines[lineIndex] as JSONLLine));
    }
});

test("test_getFirstLineTime_is_the_same_on_index_lines", (t) => {
    // Scenario: the earliest timestamp found in the index lines is the one found in the full lines.
    const folder = makeTempFolder(t);
    writeSortRulesFixture(folder);
    assert.deepEqual(getFirstLineTime(loadJSONLLineIndex([folder]).indexLines), getFirstLineTime(loadMergedJSONLLines([folder]).jsonlLines));
});

test("test_collectBashCallResults_on_index_lines_gives_the_full_line_results", (t) => {
    // Scenario: the index keeps the Bash result text, so the Bash results are the same, result text included.
    const folder = makeTempFolder(t);
    writeSortRulesFixture(folder);
    const fullResults = collectBashCallResults(loadMergedJSONLLines([folder]).jsonlLines);
    const indexResults = collectBashCallResults(loadJSONLLineIndex([folder]).indexLines);
    assert.equal(fullResults.size, 1);
    assert.deepEqual(indexResults, fullResults);
});

test("test_readFullResultLines_gives_the_full_Write_Edit_result_lines", (t) => {
    // Scenario: the Write/Edit result lines found on the index lines, read again from disk, deep-equal the full loader's.
    const folder = makeTempFolder(t);
    writeSortRulesFixture(folder);
    const fullResultLines = collectWriteEditResultLines(loadMergedJSONLLines([folder]).jsonlLines);
    const indexResultLines = readFullResultLines(collectWriteEditResultLines(loadJSONLLineIndex([folder]).indexLines));
    assert.equal(fullResultLines.size, 1);
    assert.deepEqual(indexResultLines, fullResultLines);
});

test("test_uuid_collect_steps_on_index_lines_give_the_same_results", (t) => {
    // Scenario: the fork, earlier-sibling and result-turn-snapshot steps read only ids, so they agree on both line lists.
    const folder = makeTempFolder(t);
    writeSortRulesFixture(folder);
    const fullLines = loadMergedJSONLLines([folder]).jsonlLines;
    const indexLines = loadJSONLLineIndex([folder]).indexLines;
    assert.deepEqual(collectForkedMessageIds(indexLines), collectForkedMessageIds(fullLines));
    assert.deepEqual(collectEarlierSiblingMessageIds(indexLines), collectEarlierSiblingMessageIds(fullLines));
    const fullResultTurnIds = collectResultTurnSnapshotIds(fullLines, collectWriteEditResultLines(fullLines));
    const indexResultTurnIds = collectResultTurnSnapshotIds(indexLines, collectWriteEditResultLines(indexLines));
    assert.equal(fullResultTurnIds.size, 1);
    assert.deepEqual(indexResultTurnIds, fullResultTurnIds);
});

test("test_loadJSONLLineIndex_holds_no_full_text_of_a_large_fixture", (t) => {
    // Scenario: 3 files of 1,000 lines with 4 KB of text and a 4 KB tool result each; the index holds none of that text.
    const folder = makeTempFolder(t);
    const bigText = "x".repeat(4096);
    let fileBytes = 0;
    for (const fileName of ["big1.jsonl", "big2.jsonl", "big3.jsonl"]) {
        const lines: string[] = [];
        for (let lineNumber = 0; lineNumber < 1000; lineNumber++) {
            const uuid = `${fileName}-${lineNumber}`;
            lines.push(JSON.stringify({ type: "user", uuid, parentUuid: null, sessionId: fileName, timestamp: makeTime(lineNumber), message: { role: "user", content: [{ type: "text", text: bigText }, { type: "tool_result", tool_use_id: `toolu_${uuid}`, content: bigText }] }, toolUseResult: { stdout: bigText } }));
        }
        writeFileSync(join(folder, fileName), lines.join("\n") + "\n");
        fileBytes += statSync(join(folder, fileName)).size;
    }
    const indexLines = loadJSONLLineIndex([folder]).indexLines;
    assert.equal(indexLines.length, 3000);
    let indexBytes = 0;
    for (const indexLine of indexLines) {
        indexBytes += JSON.stringify(indexLine).length;
        // No tool result payload and no text block is kept.
        assert.equal("toolUseResult" in indexLine, false);
        for (const block of getContentBlocks(indexLine)) {
            assert.notEqual(block.type, BlockType.text);
            assert.equal("content" in block, false);
        }
    }
    // The index is under 3% of the file bytes; the full loader would hold all of them.
    assert.ok(indexBytes < fileBytes * 0.03, `index ${indexBytes} bytes, files ${fileBytes} bytes`);
});
