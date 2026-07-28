import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructStepStates } from "../src/reconstruction_steps.ts";
import {
    enableProvenance,
    disableProvenance,
    drainProvenance,
} from "../src/reconstruction_provenance.ts";
import {
    createSidecarReader,
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S29_JSONL } from "./fixtures.ts";

// The seven rescue/reseed/beacon stages instrumented with noteStage — the only stages allowed to appear in the provenance log (the deterministic extraction stages 1–4 are never the culprit).
const INSTRUMENTED_STAGES = new Set([
    "seedCopyEvents",
    "fillRedirectContent",
    "seedEditBaseFromBackup",
    "injectScriptExecutions",
    "completeElidedBeacons",
    "completeTruncatedBeacon",
    "seedStaleEditBases",
]);

test("test_reconstructStepStates_with_provenance_enabled_records_instrumented_stage_entries", () => {
    // Behavior: s29 (a script-rename whose post-script beacons need backup completion) drives instrumented beacon stages during the SAME per-step reconstruction the coverage tool runs, so provenance enabled around reconstructStepStates captures at least one entry and every entry names one of the six instrumented stages — proving the sink is wired into the step path checkScenario uses.
    const records = loadRecords(S29_JSONL);
    const sessionId = findSessionId(records);
    const reader = sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
    enableProvenance();
    reconstructStepStates(records, reader);
    const entries = drainProvenance();
    disableProvenance();
    // Verify: at least one stage fired...
    assert.ok(entries.length > 0, "expected at least one instrumented stage to fire for s29");
    // ...and every entry names an instrumented stage.
    for (const entry of entries) {
        assert.ok(INSTRUMENTED_STAGES.has(entry.stage), `unexpected stage: ${entry.stage}`);
    }
});

