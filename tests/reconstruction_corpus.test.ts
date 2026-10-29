// getCorpusState and getDerivedCaches: per-records cache identity and reader-gated invalidation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getCorpusState, getDerivedCaches } from "../src/reconstruction_corpus.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

test("test_getCorpusState_is_stable_per_records_array", () => {
    const records: TranscriptRecord[] = [];
    assert.equal(getCorpusState(records), getCorpusState(records));
    assert.notEqual(getCorpusState(records), getCorpusState([]));
});

test("test_getDerivedCaches_rebuilds_only_when_reader_changes", () => {
    const records: TranscriptRecord[] = [];
    const reader: BackupReader = () => "";
    const first = getDerivedCaches(records, undefined);
    assert.equal(getDerivedCaches(records, undefined), first);
    const second = getDerivedCaches(records, reader);
    assert.notEqual(second, first);
    assert.equal(second.reader, reader);
    assert.equal(getDerivedCaches(records, reader), second);
});
