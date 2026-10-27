// GET /api/layer1-record: one transcript line, by session file and 1-based line number, parsed from the source JSONL.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { handleLayer1RecordRequest, readTranscriptLine } from "../src/viewer_api_layer1_record.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

function writeSessionFile(name: string, text: string): Path {
    const file = join(makeTempDir(), name);
    writeFileSync(file, text);
    return new Path(file);
}

test("readTranscriptLine returns the parsed record at that 1-based line, counting blank lines", () => {
    const file = writeSessionFile("s.jsonl", '{"n":1}\n\n{"n":3}\n');
    assert.deepEqual(readTranscriptLine(file, 1), { n: 1 });
    assert.deepEqual(readTranscriptLine(file, 3), { n: 3 });
});

test("readTranscriptLine throws for a blank line, a line past the end and line zero", () => {
    const file = writeSessionFile("s.jsonl", '{"n":1}\n\n{"n":3}\n');
    assert.throws(() => readTranscriptLine(file, 2), /no record at line 2/);
    assert.throws(() => readTranscriptLine(file, 9), /no record at line 9/);
    assert.throws(() => readTranscriptLine(file, 0), /not a line number/);
});

test("readTranscriptLine refuses a file that is not a .jsonl transcript", () => {
    const file = writeSessionFile("notes.txt", '{"n":1}\n');
    assert.throws(() => readTranscriptLine(file, 1), /not a transcript file/);
});

test("handleLayer1RecordRequest answers the record as JSON", () => {
    const file = writeSessionFile("s.jsonl", '{"type":"user"}\n');
    let body = "";
    const response = { writeHead: () => response, end: (chunk: string) => { body = chunk; } } as unknown as ServerResponse;
    handleLayer1RecordRequest(response, new URLSearchParams({ jsonl: file.toString(), line: "1" }));
    assert.deepEqual(JSON.parse(body), { type: "user" });
});
