// viewer_api_records: the transcript-set freshness stamp is sorted, and it changes when a file changes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { computeTranscriptSetStamp } from "../src/viewer_api_records.ts";

test("test_computeTranscriptSetStamp_sorts_segments_and_tracks_size", () => {
    const folder = mkdtempSync(join(tmpdir(), "records-stamp-"));
    const firstPath = join(folder, "a.jsonl");
    const secondPath = join(folder, "b.jsonl");
    writeFileSync(firstPath, "one");
    writeFileSync(secondPath, "three");
    const forwardStamp = computeTranscriptSetStamp([new Path(firstPath), new Path(secondPath)]);
    const reverseStamp = computeTranscriptSetStamp([new Path(secondPath), new Path(firstPath)]);
    assert.equal(forwardStamp, reverseStamp);
    assert.equal(forwardStamp.split("|").length, 2);
    writeFileSync(firstPath, "one and more");
    const changedStamp = computeTranscriptSetStamp([new Path(firstPath), new Path(secondPath)]);
    assert.notEqual(changedStamp, forwardStamp);
});
