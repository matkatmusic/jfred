// Tests src/viewer_api_build_support.ts: record selection, cache key, and the process gates of one build.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import {
    applyBuildGates,
    computeBuildCacheKey,
    resetBuildGates,
    selectBuildRecords,
} from "../src/viewer_api_build_support.ts";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { S1_JSONL } from "./fixtures.ts";

test("test_computeBuildCacheKey_differs_when_allowScripts_differs", () => {
    const paths = [new Path(S1_JSONL)];
    const consented = computeBuildCacheKey(paths, undefined, true, true);
    const degraded = computeBuildCacheKey(paths, undefined, false, true);
    assert.notEqual(consented, degraded);
});

test("test_applyBuildGates_then_resetBuildGates_restores_the_closed_gate", () => {
    applyBuildGates(true, true);
    assert.equal(isImpureExecutionAllowed(), true);
    resetBuildGates();
    assert.equal(isImpureExecutionAllowed(), false);
});

test("test_selectBuildRecords_returns_the_loaded_records_without_sources_or_bound", () => {
    const records: TranscriptRecord[] = [];
    assert.equal(selectBuildRecords(records), records);
});
