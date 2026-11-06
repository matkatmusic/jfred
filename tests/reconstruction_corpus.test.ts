// getCorpusState and getDerivedCaches: per-records cache identity and reader-gated invalidation.

// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { getCorpusState, getDerivedCaches } from "../src/reconstruction_corpus.ts";
// import type { BackupReader } from "../src/reconstruction_sidecar.ts";
// import type { TranscriptRecord } from "../src/structures/envelope.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { getFileRevisionsOver } from "../src/reconstruction_branches.ts";
import type { PathOverrides } from "../src/reconstruction_overrides.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";

test("test_derived_memo_does_not_share_an_entry_between_different_overrides", () => {
    // Scenario: same records and reader, different folders; the second call must not reuse the first memo.
    const target = new Path("/proj/a.py");
    const writeRecord = {
        type: RecordType.assistant,
        timestamp: new Date("2026-01-01T00:00:01Z"),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Write, input: { file_path: "/proj/a.py", content: "a = 1\n" }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
    const records = [writeRecord];
    const reader: BackupReader = () => "";
    const overridesOfFirstProject: PathOverrides = { repoDir: new Path("/repos/first") };
    const overridesOfSecondProject: PathOverrides = { repoDir: new Path("/repos/second") };
    // The first project computes and memoizes its history.
    const firstHistory = getFileRevisionsOver(records, target, new Set<string>(), overridesOfFirstProject, reader);
    // The same folders hit the memo.
    assert.equal(getFileRevisionsOver(records, target, new Set<string>(), overridesOfFirstProject, reader), firstHistory);
    // Different folders must recompute instead of reusing the first entry.
    const secondHistory = getFileRevisionsOver(records, target, new Set<string>(), overridesOfSecondProject, reader);
    assert.notEqual(secondHistory, firstHistory);
});

// not behavior: it only checks object identity of an internal per-records cache state.
// test("test_getCorpusState_is_stable_per_records_array", () => {
//     const records: TranscriptRecord[] = [];
//     assert.equal(getCorpusState(records), getCorpusState(records));
//     assert.notEqual(getCorpusState(records), getCorpusState([]));
// });

// not behavior: it only checks object identity and the reader field of an internal derived-cache object.
// test("test_getDerivedCaches_rebuilds_only_when_reader_changes", () => {
//     const records: TranscriptRecord[] = [];
//     const reader: BackupReader = () => "";
//     const first = getDerivedCaches(records, undefined);
//     assert.equal(getDerivedCaches(records, undefined), first);
//     const second = getDerivedCaches(records, reader);
//     assert.notEqual(second, first);
//     assert.equal(second.reader, reader);
//     assert.equal(getDerivedCaches(records, reader), second);
// });
