import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNonEmptyLines, loadRecords } from "./utilities.ts";
import { RecordType } from "../src/structures/vocabulary.ts";

test("test_readNonEmptyLines_returns_only_non_blank_lines", () => {
    // Scenario: readNonEmptyLines splits a file into lines and drops blank and
    // whitespace-only lines.
    // Steps:
    // write a file with blank and whitespace-only lines between content lines.
    const file = join(tmpdir(), "reveng-readNonEmptyLines.test.txt");
    writeFileSync(file, "first\n\n   \nsecond\n");
    try {
        // only the two content lines survive.
        assert.deepEqual(readNonEmptyLines(file), ["first", "second"]);
    } finally {
        rmSync(file, { force: true });
    }
});

test("test_loadRecords_parses_every_non_blank_line_into_typed_records", () => {
    // Scenario: loadRecords reads a JSONL file and parses each non-empty line
    // into a typed record (blank lines skipped).
    // Steps:
    // write a two-record JSONL file with a trailing blank line.
    const file = join(tmpdir(), "reveng-loadRecords.test.jsonl");
    writeFileSync(
        file,
        '{"type":"mode","sessionId":"s","mode":"normal"}\n' +
            '{"type":"mode","sessionId":"t","mode":"normal"}\n\n',
    );
    try {
        // both records parse; the blank line is skipped.
        const records = loadRecords(file);
        assert.equal(records.length, 2);
        assert.equal(records[0]!.type, RecordType.mode);
    } finally {
        rmSync(file, { force: true });
    }
});

