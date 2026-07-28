// Item 82 — loading-progress overhaul. Pure-helper coverage: the server's document size-label (A1), the cache-hit record-replay throttle (B1), and the client's phase classifier (C1). The overlay DOM, elapsed clock, and paint-yield are visually verified by the user (project console-helper convention), so they carry no unit test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { type ProgressEvent } from "../src/parse/loadTranscript.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { formatSendingDocumentLabel } from "../src/viewer_api.ts";
import {
    computeRecordProgressStride,
    RECORD_PROGRESS_MAX_LINES,
    loadProjectRecords,
} from "../src/viewer_api_records.ts";
import { matchJsonlSourceLink } from "../webapp/app-console.ts";
import { reconcileServerBootId } from "../webapp/app-choices.ts";
import { classifyLoadPhase, LOAD_PHASE_COUNT } from "../webapp/app-progress.ts";
import { S19_JSONL } from "./fixtures.ts";
import { copyFixtureIntoTempDir } from "./utilities.ts";

// -------------------- A1: document size-label formatter --------------------

test("test_formatSendingDocumentLabel_reports_megabytes_to_one_decimal", () => {
    assert.equal(formatSendingDocumentLabel(67_100_000), "sending document (67.1 MB)");
    assert.equal(formatSendingDocumentLabel(0), "sending document (0.0 MB)");
});

// -------------------- B1: cache-hit record-replay throttle --------------------

test("test_computeRecordProgressStride_bounds_line_count", () => {
    // Large sets stride down to at most RECORD_PROGRESS_MAX_LINES emitted lines.
    assert.equal(computeRecordProgressStride(20_000), Math.ceil(20_000 / RECORD_PROGRESS_MAX_LINES));
    // Fewer records than the cap → stride 1 (every record). Zero → 1, never 0 (guards against % 0).
    assert.equal(computeRecordProgressStride(10), 1);
    assert.equal(computeRecordProgressStride(0), 1);
});

test("test_cached_record_replay_is_throttled_counted_and_token_bearing", () => {
    // Prime both caches, then re-run the cache-hit replay through a spy sink and assert the per-record events are bounded, monotonic, reach 100%, and still carry the clickable source token.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).records.length;
    loadProjectRecords([jsonlPath]);
    const events: ProgressEvent[] = [];
    loadProjectRecords([jsonlPath], (event) => events.push(event));
    const perRecord = events.filter((event) => event.total === recordCount);
    assert.ok(perRecord.length >= 1 && perRecord.length <= RECORD_PROGRESS_MAX_LINES,
        `expected 1..${RECORD_PROGRESS_MAX_LINES} per-record lines, got ${perRecord.length}`);
    for (let i = 1; i < perRecord.length; i++) {
        assert.ok(perRecord[i]!.current! > perRecord[i - 1]!.current!, "current must strictly increase");
    }
    assert.equal(perRecord.at(-1)!.current, recordCount, "last per-record event must reach 100%");
    for (const event of perRecord) {
        assert.ok(matchJsonlSourceLink(event.label) !== undefined, `no source token in "${event.label}"`);
    }
});

// -------------------- C1: client phase classifier --------------------

test("test_classifyLoadPhase_maps_real_stage_labels_to_ordered_phases", () => {
    const cases: [string, number | undefined][] = [
        ["resolving transcript files for X", 1],
        ["resolved 16 transcript file(s)", 1],
        ["reusing cached transcript records", 2],
        ["assistant [x.jsonl:9]", 2],
        ["scanning parsed records for recorded script executions", 3],
        ["no script-execution consent needed", 3],
        ["reusing cached document artifact", 4],
        ["reading sidecar backups", 4],
        ["reconstructing orders.py", 4],
        ["building step snapshots", 4],
        ["building line verdicts", 4],
        ["serializing document", 5],
        ["sending document (67.1 MB)", 5],
        ["parsing document — 67.1 MB", 5],
        ["preparing timeline…", 6],
        ["Building timeline… 3 / 1200 rows", 6],
        ["???", undefined],
    ];
    for (const [label, expected] of cases) {
        assert.equal(classifyLoadPhase(label), expected, `phase for "${label}"`);
    }
});

test("test_classifyLoadPhase_total_is_six", () => {
    assert.equal(LOAD_PHASE_COUNT, 6);
});

// task 163: the branch-enumeration counter must land in phase 4 (Building document), like every other deep-engine label of the build stage.
test("test_classifyLoadPhase_places_branch_tip_scanning_in_the_build_phase", () => {
    assert.equal(classifyLoadPhase("scanning branch tips — 3 / 12"), 4);
});

// -------------------- server boot-id consent reset --------------------

// Minimal in-memory stand-in for the browser's sessionStorage (reconcileServerBootId reads length/key/getItem and mutates set/removeItem). Typed loosely — the test runs under node, not DOM.
function makeSessionStorageStub(): any {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        key: (i: number) => [...map.keys()][i] ?? null,
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => { map.set(k, v); },
        removeItem: (k: string) => { map.delete(k); },
    };
}

test("test_reconcileServerBootId_clears_consent_only_when_boot_id_changes", () => {
    const stub = makeSessionStorageStub();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = stub;
    try {
        stub.setItem("consent:projA", "1");
        stub.setItem("consent:projB", "0");
        stub.setItem("unrelated", "keep");
        // First launch (no stored boot id): drop consent, remember the id — but leave non-consent keys.
        reconcileServerBootId("boot-1");
        assert.equal(stub.getItem("consent:projA"), null);
        assert.equal(stub.getItem("consent:projB"), null);
        assert.equal(stub.getItem("unrelated"), "keep");
        assert.equal(stub.getItem("serverBootId"), "boot-1");
        // Same id (page reload): consent preserved.
        stub.setItem("consent:projC", "1");
        reconcileServerBootId("boot-1");
        assert.equal(stub.getItem("consent:projC"), "1");
        // New id (server relaunched): consent cleared again, id updated.
        reconcileServerBootId("boot-2");
        assert.equal(stub.getItem("consent:projC"), null);
        assert.equal(stub.getItem("serverBootId"), "boot-2");
    } finally {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
});

