// splitNdjsonChunk: complete lines are returned, the trailing partial line stays in the remainder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitNdjsonChunk } from "../webapp/app-ndjson.ts";

test("test_splitNdjsonChunk_drops_empty_lines_and_keeps_partial_remainder", () => {
    const result = splitNdjsonChunk("{\"a\"", ":1}\n\n{\"b\":2}\n{\"c\"");
    assert.deepEqual(result.lines, ["{\"a\":1}", "{\"b\":2}"]);
    assert.equal(result.remainder, "{\"c\"");
});
