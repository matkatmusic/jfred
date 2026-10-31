// file_stamp_cache: a per-file value is reused until the file changes, and survives a restart through the cache file.

import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStampCache, clearFileStampCaches, saveFileStampCachesIfChanged, setFileStampCachePath } from "../src/file_stamp_cache.ts";
import { readSessionEditEvents } from "../src/layer1_edit_events.ts";
import { Path } from "../src/structures/domain.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildEditRecordPair, buildWriteRecordPair, type RecordEnvelope } from "./tool-call-record-pair-builders.ts";

function buildEnvelope(toolId: string, minute: number): RecordEnvelope {
    return { sessionId: SESSION_A, cwd: "/work", timestamp: `2026-07-24T10:0${minute}:00.000Z`, toolId, parentUuid: null };
}

test("test_second_read_of_an_unchanged_file_returns_the_same_object_and_a_touch_rebuilds", () => {
    const folder = mkdtempSync(join(tmpdir(), "file-stamp-cache-"));
    const file = new Path(join(folder, "a.jsonl"));
    writeFileSync(file.toString(), "one");
    const cache = new FileStampCache<{ built: number }>("identityTest", { encode: (value) => value, decode: (json) => json as { built: number } });
    let buildCount = 0;
    const buildValue = () => ({ built: ++buildCount });
    const first = cache.readThrough(file, buildValue);
    assert.equal(cache.readThrough(file, buildValue), first);
    assert.equal(buildCount, 1);
    appendFileSync(file.toString(), " and more");
    const second = cache.readThrough(file, buildValue);
    assert.notEqual(second, first);
    assert.equal(second.built, 2);
});

test("test_cache_file_round_trips_domain_types_and_skips_the_transcript_read", () => {
    const tree = createSourceTree("-cache-file-project");
    const edit = buildEditRecordPair(buildEnvelope("toolu_e1", 1), "/work/a.py", "uno\n", "one\n", { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-one", "+uno"] });
    const write = buildWriteRecordPair(buildEnvelope("toolu_w1", 2), "/work/b.py", "body\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...edit.records, ...write.records]);
    const sessionFile = join(tree.projectDir, "a.jsonl");
    const cacheFile = join(mkdtempSync(join(tmpdir(), "file-stamp-cache-file-")), "cache.json");
    setFileStampCachePath(new Path(cacheFile));
    clearFileStampCaches();
    const fresh = readSessionEditEvents(new Path(sessionFile));
    assert.equal(fresh.length, 2);
    saveFileStampCachesIfChanged();
    assert.equal(JSON.parse(readFileSync(cacheFile, "utf8")).version, 1);
    // stat still works on an unreadable file, so a re-read would throw EACCES.
    chmodSync(sessionFile, 0o000);
    clearFileStampCaches();
    assert.deepEqual(readSessionEditEvents(new Path(sessionFile)), fresh);
});

test("test_cache_file_with_another_format_version_is_ignored", () => {
    const tree = createSourceTree("-cache-version-project");
    const write = buildWriteRecordPair(buildEnvelope("toolu_w1", 1), "/work/b.py", "body\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", write.records);
    const cacheFile = join(mkdtempSync(join(tmpdir(), "file-stamp-cache-version-")), "cache.json");
    setFileStampCachePath(new Path(cacheFile));
    clearFileStampCaches();
    const sessionFile = new Path(join(tree.projectDir, "a.jsonl"));
    readSessionEditEvents(sessionFile);
    saveFileStampCachesIfChanged();
    writeFileSync(cacheFile, readFileSync(cacheFile, "utf8").replace('"version":1', '"version":0'));
    clearFileStampCaches();
    assert.equal(readSessionEditEvents(sessionFile).length, 1);
});
