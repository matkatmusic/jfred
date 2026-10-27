// GET /api/scan-source (task 296): the picker's emptiness check, split from the sessions tests.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureViewer } from "./layer1-view-test-helpers.ts";

// 20900 is taken by the sessions test; parallel files must never collide.
const SCRATCH_PORT = 21400 + (process.pid % 500);

const sourceDir = mkdtempSync(join(tmpdir(), "layer1-scan-"));
writeFileSync(join(sourceDir, "one.jsonl"), "{}\n");
const emptyDir = mkdtempSync(join(tmpdir(), "layer1-scan-empty-"));
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await startFixtureViewer(sourceDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

async function requestScanCount(folder: string, kind: string): Promise<number> {
    const query = new URLSearchParams({ path: folder, kind });
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/scan-source?${query.toString()}`);
    assert.equal(response.status, 200);
    return (await response.json() as { found: number }).found;
}

test("test_scan_source_reports_a_hit_for_a_folder_holding_transcripts", async () => {
    assert.ok(await requestScanCount(sourceDir, "jsonl") >= 1);
});

test("test_scan_source_reports_zero_for_a_folder_with_no_transcripts", async () => {
    // The picker refuses a folder on exactly this answer, so it is the load-bearing case.
    assert.equal(await requestScanCount(emptyDir, "jsonl"), 0);
});

test("test_scan_source_counts_every_regular_file_for_the_file_history_kind", async () => {
    // Snapshot names are hashes with no extension, so any regular file counts; only the empty folder answers 0.
    assert.ok(await requestScanCount(sourceDir, "filehistory") >= 1);
    assert.equal(await requestScanCount(emptyDir, "filehistory"), 0);
});

test("test_scan_source_refuses_a_missing_folder_and_an_unknown_kind", async () => {
    const missing = await fetch(
        `http://127.0.0.1:${SCRATCH_PORT}/api/scan-source?path=${encodeURIComponent(join(sourceDir, "nope"))}&kind=jsonl`);
    assert.equal(missing.status, 400);
    const badKind = await fetch(
        `http://127.0.0.1:${SCRATCH_PORT}/api/scan-source?path=${encodeURIComponent(sourceDir)}&kind=zip`);
    assert.equal(badKind.status, 400);
    assert.match(await badKind.text(), /unknown source kind/);
});
