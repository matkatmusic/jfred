import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStepStates, type RepoSnapshot } from "../src/reconstruction_steps.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { createSidecarReader } from "../src/reconstruction_sidecar_backup_path.ts";
import {
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S2_JSONL, S19_JSONL } from "./fixtures.ts";

// // s2-move-file: a Bash `mv` renames `s2_original.py` to `s2_moved.py` mid-stream.
// const S2_JSONL = "scenarios/executed/s2-move-file/<uuid>.jsonl";

// The on-disk file-history reader for a transcript's session, built exactly as the CLI builds it.
function realReader(records: ReturnType<typeof loadRecords>): BackupReader | undefined {
    const sessionId = findSessionId(records);
    return sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
}

// Whether any snapshot key has this exact basename, avoiding suffix collisions like `test_s2_original.py`.
function hasFileNamed(snapshot: RepoSnapshot, basename: string): boolean {
    return [...snapshot.keys()].some((path) => path.toString().split("/").pop() === basename);
}

test("test_buildStepStates_keys_a_premove_file_by_its_old_name", () => {
    // Behavior: before the mv, the snapshot keys the file as `s2_original.py`, not `s2_moved.py`.
    const records = loadRecords(S2_JSONL);
    const steps = buildStepStates(records, realReader(records));
    // Step: the first step is the pre-move write (before the mv).
    const preMoveStep = steps[0]!;
    // Verify: keyed by the old name, not the post-move name.
    assert.ok(hasFileNamed(preMoveStep, "s2_original.py"), "pre-move step should key s2_original.py");
    assert.ok(!hasFileNamed(preMoveStep, "s2_moved.py"), "pre-move step should NOT key s2_moved.py");
});

test("test_buildStepStates_keys_a_postmove_file_by_its_new_name", () => {
    // Behavior: after the mv, the snapshot keys the file as `s2_moved.py`, not `s2_original.py`.
    const records = loadRecords(S2_JSONL);
    const steps = buildStepStates(records, realReader(records));
    // Step: the last step is the final disk state (after the mv).
    const finalStep = steps[steps.length - 1]!;
    // Verify: keyed by the new name, not the pre-move name.
    assert.ok(hasFileNamed(finalStep, "s2_moved.py"), "final step should key s2_moved.py");
    assert.ok(!hasFileNamed(finalStep, "s2_original.py"), "final step should NOT key s2_original.py");
});

test("test_buildStepStates_is_unchanged_for_a_rename_free_scenario", () => {
    // Behavior: s19 has no rename, so every step keys each file by its only name.
    const records = loadRecords(S19_JSONL);
    const steps = buildStepStates(records, realReader(records));
    // Verify: the first step keys only scenario19.py...
    assert.ok(hasFileNamed(steps[0]!, "scenario19.py"), "s19 first step should key scenario19.py");
    assert.ok(
        !hasFileNamed(steps[0]!, "test_scenario19.py"),
        "s19 first step should not key the test file yet",
    );
    // ...and the final step keys both the scenario file and the test file under their only names.
    const finalStep = steps[steps.length - 1]!;
    assert.ok(hasFileNamed(finalStep, "scenario19.py"), "s19 final step should key scenario19.py");
    assert.ok(
        hasFileNamed(finalStep, "test_scenario19.py"),
        "s19 final step should key the test file",
    );
});

