// Tolerant-mode (viewer) parsing: unparseable lines are skipped and captured as SkippedLines instead of aborting the load. Split from loadTranscript.test.ts (250-line cap).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { UnknownRecordTypeError } from "../src/parse/parseRecord.ts";
import { loadProjectRecords } from "../src/viewer_api_records.ts";
import { Path } from "../src/structures/domain.ts";

// Write a throwaway .jsonl with the given lines, in a fresh temp dir (a fresh path is also a fresh transcript-set stamp, so the loadProjectRecords cache test starts cold).
function writeTempJsonl(lines: string[]): string {
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-loadTranscript-"));
    const jsonlPath = join(tempDir, "session.jsonl");
    writeFileSync(jsonlPath, lines.join("\n") + "\n");
    return jsonlPath;
}

// One valid line for the tolerant-skip fixtures (a minimal mode record).
const VALID_MODE_LINE = JSON.stringify({ type: "mode", sessionId: "s", mode: "normal" });

// One line whose `type` is outside the known vocabulary but whose JSON still parses.
const UNKNOWN_TYPE_LINE = JSON.stringify({ type: "future-nonsense", timestamp: "2026-01-01T00:00:00Z" });

test("test_loadTranscript_tolerant_skips_unknown_record_type_and_records_reason", () => {
    // Scenario: the viewer's tolerant load survives a record type outside the known vocabulary — the line is skipped and captured with its reason and (hydrated) timestamp, not thrown.  Steps: load a file with one valid record and one unknown-type line, tolerantly.
    const jsonlPath = writeTempJsonl([VALID_MODE_LINE, UNKNOWN_TYPE_LINE]);
    const { records, skippedLines } = loadTranscript(jsonlPath, undefined, true);
    // the valid record still loads.
    assert.equal(records.length, 1);
    // the unknown-type line becomes one SkippedLine naming the offending type.
    assert.equal(skippedLines.length, 1);
    assert.ok(skippedLines[0]!.reason.includes("future-nonsense"));
    assert.equal(skippedLines[0]!.lineNumber, 2);
    // the raw line's timestamp string rides along, hydrated to a Date.
    assert.deepEqual(skippedLines[0]!.timestamp, new Date("2026-01-01T00:00:00Z"));
});

test("test_loadTranscript_tolerant_skips_malformed_json_line", () => {
    // Scenario: a line that is not JSON at all is skipped with a "malformed JSON" reason; no timestamp can be read from it.
    const jsonlPath = writeTempJsonl([VALID_MODE_LINE, "not json{"]);
    const { records, skippedLines } = loadTranscript(jsonlPath, undefined, true);
    assert.equal(records.length, 1);
    assert.equal(skippedLines.length, 1);
    assert.ok(skippedLines[0]!.reason.includes("malformed JSON"));
    assert.equal(skippedLines[0]!.timestamp, undefined);
});

test("test_loadTranscript_strict_still_throws_on_unknown_record_type", () => {
    // Scenario: strict mode (the CLI and the tests) keeps the fog-of-war guard — the same unknown-type fixture that tolerant mode skips still throws.
    const jsonlPath = writeTempJsonl([VALID_MODE_LINE, UNKNOWN_TYPE_LINE]);
    assert.throws(() => loadTranscript(jsonlPath), UnknownRecordTypeError);
});

test("test_loadProjectRecords_caches_skipped_lines_with_records", () => {
    // Scenario: skips are discovered at parse time, so the parsed-records cache must carry them — a warm rebuild reports the same gaps as the cold load.  Steps: load the same fixture set twice (cold parse, then cache hit).
    const jsonlPath = new Path(writeTempJsonl([VALID_MODE_LINE, UNKNOWN_TYPE_LINE]));
    const first = loadProjectRecords([jsonlPath]);
    const second = loadProjectRecords([jsonlPath]);
    assert.equal(first.skippedLines.length, 1);
    assert.equal(second.skippedLines.length, first.skippedLines.length);
});
