import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { containsCaptureDependentImport, isTestFileCaptureFree, listCaptureFreeTestPaths } from "../scripts/list_capture_free_tests.ts";

// The CI list drops capture-reading test files and keeps capture-free ones.

function pathOfTestFile(testFileName: string): string {
    return fileURLToPath(new URL(`./${testFileName}`, import.meta.url));
}

test("test_direct_fixture_importer_is_capture_dependent", () => {
    assert.equal(containsCaptureDependentImport(pathOfTestFile("loadTranscript.test.ts")), true);
});

test("test_transitive_fixture_importer_is_capture_dependent", () => {
    assert.equal(containsCaptureDependentImport(pathOfTestFile("timeline-picks.test.ts")), true);
});

test("test_coverage_scenarios_importer_is_capture_dependent", () => {
    assert.equal(isTestFileCaptureFree(pathOfTestFile("scenario_coverage.test.ts")), false);
});

test("test_transitive_coverage_scenarios_reacher_stays_runnable", () => {
    // Reaches coverage_scenarios.ts only through check_scenario_coverage.ts helpers, which scan lazily — the file loads and passes on a captureless clone, so it must stay in the CI list.
    assert.equal(isTestFileCaptureFree(pathOfTestFile("reconstruction_trunk.test.ts")), true);
});

test("test_capture_free_file_is_runnable", () => {
    assert.equal(containsCaptureDependentImport(pathOfTestFile("recordKeys.test.ts")), false);
});

test("test_list_contains_this_suite_and_no_fixture_importers", () => {
    const captureFreePaths = listCaptureFreeTestPaths();
    assert.ok(captureFreePaths.includes("tests/list_capture_free_tests.test.ts"));
    assert.ok(!captureFreePaths.includes("tests/loadTranscript.test.ts"));
});
