import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStepStates } from "../src/reconstruction_steps.ts";
import {
    enableProvenance,
    disableProvenance,
    getAndClearProvenance,
} from "../src/reconstruction_provenance.ts";
import { createSidecarReader } from "../src/reconstruction_sidecar_backup_path.ts";
import {
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S29_JSONL } from "./fixtures.ts";

// The seven stages instrumented with addStageEntry: the only stages allowed in the provenance log.
const INSTRUMENTED_STAGES = new Set([
    "seedCopyEvents",
    "fillRedirectContent",
    "seedEditBaseFromBackup",
    "injectScriptExecutions",
    "completeElidedBeacons",
    "completeTruncatedBeacon",
    "seedStaleEditBases",
]);

test("test_buildStepStates_with_provenance_enabled_records_instrumented_stage_entries", () => {
    // Behavior: s29 under buildStepStates records at least one entry, each naming an instrumented stage.
    const records = loadRecords(S29_JSONL);
    const sessionId = findSessionId(records);
    const reader = sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
    enableProvenance();
    buildStepStates(records, reader);
    const entries = getAndClearProvenance();
    disableProvenance();
    // Verify: at least one stage fired...
    assert.ok(entries.length > 0, "expected at least one instrumented stage to fire for s29");
    // ...and every entry names an instrumented stage.
    for (const entry of entries) {
        assert.ok(INSTRUMENTED_STAGES.has(entry.stage), `unexpected stage: ${entry.stage}`);
    }
});

