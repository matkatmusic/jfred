// Layer 6 real check: the viewer it starts must save replay results in a temp file, not in jfred/.cache.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildViewerArguments } from "../scripts/visual/layer6-real-viewer-args.ts";

const TEMP_FILES = { settingsFile: "/tmp/s.json", cacheFile: "/tmp/c.json", memoFile: "/tmp/m.json", runResultsFile: "/tmp/r.json" };

test("test_viewer_arguments_pass_the_temp_run_results_file", () => {
    // Scenario: the real check starts a viewer with a temp results file.
    const viewerArguments = buildViewerArguments("/recovery", 18200, TEMP_FILES);
    // The flag is followed by the temp path, so an earlier saved result cannot be restored.
    const flagIndex = viewerArguments.indexOf("--run-results-file");
    assert.ok(flagIndex >= 0);
    assert.equal(viewerArguments[flagIndex + 1], "/tmp/r.json");
});

test("test_viewer_arguments_pass_the_port_and_the_recovery_folders", () => {
    const viewerArguments = buildViewerArguments("/recovery", 18200, TEMP_FILES);
    assert.equal(viewerArguments[viewerArguments.indexOf("--port") + 1], "18200");
    assert.equal(viewerArguments[viewerArguments.indexOf("--projects-dir") + 1], "/recovery/projects");
    assert.equal(viewerArguments[viewerArguments.indexOf("--file-history-dir") + 1], "/recovery/file-history");
});
